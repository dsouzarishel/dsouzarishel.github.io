import { capturePage, exportPagesToPdf, exportPagesToZip } from "./capture.js";
import { runSimulationDatasetBenchmark } from "./benchmark.js?v=simulation-10";
import { analyzeStillCanvas, createFrameAnalyzer, frameDifference } from "./vision.js?v=epoch-8";

const elements = {
  video: document.querySelector("#cameraFeed"),
  overlay: document.querySelector("#overlayCanvas"),
  analysisCanvas: document.querySelector("#analysisCanvas"),
  sourceCanvas: document.querySelector("#sourceCanvas"),
  viewer: document.querySelector("[data-viewer]"),
  status: document.querySelector("[data-status]"),
  pages: document.querySelector("[data-pages]"),
  pagesPanel: document.querySelector(".pages-panel"),
  pageCount: document.querySelector("[data-page-count]"),
  pageCountLarge: document.querySelector("[data-page-count-large]"),
  scanState: document.querySelector("[data-scan-state]"),
  start: document.querySelector('[data-action="start"]'),
  uploadLabel: document.querySelector("[data-upload-label]"),
  uploadInput: document.querySelector("#videoUpload"),
  stop: document.querySelector('[data-action="stop"]'),
  exportPdf: document.querySelector('[data-action="export-pdf"]'),
  exportZip: document.querySelector('[data-action="export-zip"]'),
  exportActions: document.querySelector("[data-export-actions]"),
  clear: document.querySelector('[data-action="clear"]'),
  benchmarkStart: document.querySelector('[data-action="benchmark-start"]'),
  benchmarkPanel: document.querySelector("[data-benchmark-panel]"),
  benchmarkMark: document.querySelector('[data-action="benchmark-mark"]'),
  benchmarkStop: document.querySelector('[data-action="benchmark-stop"]'),
  benchmarkPage: document.querySelector("[data-benchmark-page]"),
  benchmarkTime: document.querySelector("[data-benchmark-time]"),
  benchmarkDownloads: document.querySelector("[data-benchmark-downloads]"),
  benchmarkVideoDownload: document.querySelector("[data-benchmark-video-download]"),
  benchmarkLabelDownload: document.querySelector("[data-benchmark-label-download]"),
  metricDocument: document.querySelector('[data-metric="document"]'),
  metricQuality: document.querySelector('[data-metric="quality"]'),
  metricSharpness: document.querySelector('[data-metric="sharpness"]'),
  metricChange: document.querySelector('[data-metric="change"]'),
  metrics: document.querySelector(".metrics"),
  qualityMeter: document.querySelector('[data-meter="quality"]')
};

const state = {
  detector: null,
  stream: null,
  uploadUrl: null,
  sourceMode: null,
  running: false,
  pages: [],
  pageClusters: [],
  currentPageIndex: -1,
  contextReady: false,
  scanStartedAt: 0,
  scanStartedVideoTime: 0,
  lastContextReviewAt: 0,
  lastDetection: null,
  capturedSignatures: [],
  stableFrames: 0,
  transitionFrames: 0,
  candidate: null,
  cooldownUntil: 0,
  analyzing: false,
  captureInProgress: false,
  benchmarking: false,
  benchmark: null
};

const AUTO_CAPTURE = {
  intervalMs: 80,
  uploadPlaybackRate: 1.5,
  cooldownMs: 650,
  stableFrames: 1,
  firstFrames: 1,
  changeFrames: 1,
  sameThreshold: 0.17,
  sameLooseThreshold: 0.22,
  sameMedianThreshold: 0.25,
  savedDuplicateThreshold: 0.11,
  changeThreshold: 0.23,
  changeMedianThreshold: 0.245,
  afterTransitionThreshold: 0.2,
  hardChangeThreshold: 0.43,
  minCaptureQuality: 52,
  minFirstQuality: 60,
  minEpochMs: 6000,
  uploadMinEpochMs: 11000,
  contextWarmupMs: 18000,
  uploadInitialIgnoreMs: 22000,
  contextReviewMs: 1800,
  provisionalReviewMs: 12500,
  promoteMinQuality: 52,
  promoteMinSharpness: 8,
  promoteMinPaperPresence: 0.5,
  duplicatePruneThreshold: 0.12,
  duplicatePruneRepresentativeThreshold: 0.24,
  duplicatePruneMedianThreshold: 0.25,
  turnFrames: 2,
  candidateMaxDrift: 0.26,
  candidateImagePoolSize: 5,
  candidateImageCooldownMs: 850,
  candidateImageMinQuality: 52,
  candidateImageScoreMargin: 2,
  clusterSize: 18,
  replaceMargin: 3
};

let lastAnalyzeAt = 0;
const debugEnabled = new URLSearchParams(window.location.search).has("debug");

if (debugEnabled) {
  window.paperSweepDebug = {
    events: []
  };
}

boot();

async function boot() {
  wireEvents();

  try {
    state.detector = createFrameAnalyzer(elements.analysisCanvas);
    runVisionSelfTest();
    setStatus("Ready. Start the camera or upload a video.");
    elements.start.disabled = false;
    setUploadEnabled(true);
    updateControlVisibility();
    maybeRunBenchmark();
  } catch (error) {
    setStatus(`Frame analysis could not start: ${error.message}`);
    elements.start.disabled = true;
    setUploadEnabled(false);
    updateControlVisibility();
  }
}

function wireEvents() {
  elements.start.addEventListener("click", startCamera);
  elements.uploadInput.addEventListener("change", handleVideoUpload);
  elements.video.addEventListener("ended", handleVideoEnded);
  elements.stop.addEventListener("click", stopCamera);
  elements.exportPdf.addEventListener("click", exportCurrentPdf);
  elements.exportZip.addEventListener("click", exportCurrentZip);
  elements.clear.addEventListener("click", clearPages);
  elements.benchmarkStart.addEventListener("click", startBenchmarkRecording);
  elements.benchmarkMark.addEventListener("click", markBenchmarkPage);
  elements.benchmarkStop.addEventListener("click", () => stopBenchmarkRecording());
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser cannot open the camera. Try a recent mobile browser.");
    return;
  }

  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    setStatus("Use HTTPS or localhost to start the camera.");
    return;
  }

  try {
    elements.start.disabled = true;
    setStatus("Asking for camera permission...");
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    elements.video.srcObject = state.stream;
    await elements.video.play();
    syncOverlaySize();
    state.running = true;
    elements.viewer.classList.add("is-live");
    elements.stop.disabled = false;
    elements.start.disabled = true;
    elements.start.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i> Scanning';
    setScanState("Scanning");
    setStatus("Auto capture is running. Flip pages normally.");
    beginScanning("camera");
    updateControlVisibility();
  } catch (error) {
    elements.start.disabled = false;
    setStatus(`Camera could not start: ${error.message}`);
    updateControlVisibility();
  }
}

async function handleVideoUpload(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  stopActiveSource({ keepStatus: true });
  resetScanMemory();

  if (state.uploadUrl) {
    URL.revokeObjectURL(state.uploadUrl);
  }

  state.uploadUrl = URL.createObjectURL(file);
  elements.video.srcObject = null;
  elements.video.src = state.uploadUrl;
  elements.video.muted = true;
  elements.video.playsInline = true;
  elements.video.loop = false;
  elements.video.playbackRate = AUTO_CAPTURE.uploadPlaybackRate;

  setStatus("Loading uploaded video...");

  try {
    await waitForVideoMetadata(elements.video);
    elements.video.playbackRate = AUTO_CAPTURE.uploadPlaybackRate;
    await elements.video.play();
    elements.video.playbackRate = AUTO_CAPTURE.uploadPlaybackRate;
    syncOverlaySize();
    elements.viewer.classList.add("is-live");
    elements.stop.disabled = false;
    elements.start.disabled = true;
    elements.start.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i> Scanning';
    setScanState("Scanning");
    setStatus("Reading the video. Sharp changed documents save automatically.");
    beginScanning("upload");
    updateControlVisibility();
  } catch (error) {
    setStatus(`We could not read that video: ${error.message}`);
    stopActiveSource({ keepStatus: true });
  } finally {
    elements.uploadInput.value = "";
  }
}

function stopCamera() {
  stopActiveSource();
}

function stopActiveSource(options = {}) {
  if (state.benchmarking) {
    stopBenchmarkRecording({ keepStatus: true });
  }
  state.running = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  elements.video.pause();
  elements.video.srcObject = null;
  if (state.sourceMode === "upload") {
    elements.video.removeAttribute("src");
    elements.video.load();
  }
  elements.viewer.classList.remove("is-live");
  elements.start.disabled = false;
  elements.start.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i> Resume camera';
  elements.stop.disabled = true;
  if (state.sourceMode === "upload" && state.uploadUrl) {
    URL.revokeObjectURL(state.uploadUrl);
    state.uploadUrl = null;
  }
  state.sourceMode = null;
  resetScanMemory();
  clearOverlay();
  updateMetrics(null);
  elements.start.innerHTML = '<i class="fa-solid fa-video" aria-hidden="true"></i> Start camera';
  setScanState("Stopped");
  if (!options.keepStatus) {
    setStatus("Auto capture stopped.");
  }
  updateControlVisibility();
}

function handleVideoEnded() {
  if (state.sourceMode !== "upload") {
    return;
  }

  reviewContextMemory({ force: true, final: true });
  const savedCount = getVisiblePageCount();
  stopActiveSource({ keepStatus: true });
  setStatus(`Video finished. ${savedCount} document${savedCount === 1 ? "" : "s"} saved.`);
  updateControlVisibility();
}

function beginScanning(sourceMode) {
  state.sourceMode = sourceMode;
  state.running = true;
  state.contextReady = getVisiblePageCount() > 0;
  state.scanStartedAt = performance.now();
  state.scanStartedVideoTime = elements.video.currentTime || 0;
  state.lastContextReviewAt = 0;
  requestAnimationFrame(scanLoop);
}

function resetScanMemory() {
  state.lastDetection = null;
  state.stableFrames = 0;
  state.transitionFrames = 0;
  state.currentPageIndex = state.pageClusters.length ? state.pageClusters.length - 1 : -1;
  state.contextReady = getVisiblePageCount() > 0;
  state.scanStartedAt = 0;
  state.scanStartedVideoTime = 0;
  state.lastContextReviewAt = 0;
  resetCandidate();
  state.cooldownUntil = 0;
}

function scanLoop(timestamp) {
  if (!state.running) {
    return;
  }

  if (!state.analyzing && timestamp - lastAnalyzeAt >= AUTO_CAPTURE.intervalMs) {
    lastAnalyzeAt = timestamp;
    state.analyzing = true;

    try {
      const detection = state.detector.analyze(elements.video);
      const changed = differenceFromRecentCaptures(detection.signature);

      state.stableFrames = detection.ready ? state.stableFrames + 1 : 0;
      state.lastDetection = detection;

      drawOverlay(detection, state.stableFrames);
      if (state.benchmarking) {
        updateMetricValues(detection, changed);
        setScanState("Benchmark");
      } else {
        updateMetrics(detection, changed);
        maybeAutoCapture(detection, changed);
      }
    } catch (error) {
      setStatus(`Auto capture paused: ${error.message}`);
    } finally {
      state.analyzing = false;
    }
  }

  requestAnimationFrame(scanLoop);
}

async function maybeAutoCapture(detection, changed) {
  if (state.benchmarking) {
    return;
  }

  if (state.captureInProgress) {
    return;
  }

  reviewContextMemory();

  if (!detection.ready) {
    registerTransition(detection);
    return;
  }

  const now = performance.now();
  if (now < state.cooldownUntil || state.stableFrames < AUTO_CAPTURE.stableFrames) {
    return;
  }

  const currentCluster = getCurrentCluster();
  if (detection.quality < AUTO_CAPTURE.minCaptureQuality) {
    if (currentCluster) {
      state.transitionFrames += 1;
    }
    resetCandidate();
    return;
  }

  if (!currentCluster) {
    if (detection.quality < AUTO_CAPTURE.minFirstQuality) {
      resetCandidate();
      return;
    }

    updateCandidate(detection, { min: 1, median: 1, representative: 1 });
    if (state.candidate.frames >= AUTO_CAPTURE.firstFrames) {
      await saveNewEpoch(detection);
    }
    return;
  }

  const distance = clusterDistance(currentCluster, detection.signature);
  if (isSameEpoch(distance)) {
    addSignatureToCluster(currentCluster, detection.signature);
    maybeStoreLocalCandidate(detection, currentCluster, state.currentPageIndex);
    await maybeReplaceCurrentPage(detection);
    state.transitionFrames = 0;
    resetCandidate();
    return;
  }

  const duplicate = savedClusterDistance(detection.signature, state.currentPageIndex);
  if (duplicate.min <= AUTO_CAPTURE.savedDuplicateThreshold) {
    resetCandidate();
    state.transitionFrames = 0;
    return;
  }

  if (
    state.transitionFrames < AUTO_CAPTURE.turnFrames &&
    distance.representative < AUTO_CAPTURE.hardChangeThreshold
  ) {
    addSignatureToCluster(currentCluster, detection.signature);
    maybeStoreLocalCandidate(detection, currentCluster, state.currentPageIndex);
    await maybeReplaceCurrentPage(detection);
    resetCandidate();
    return;
  }

  if (!isMaterialChange(distance)) {
    resetCandidate();
    return;
  }

  updateCandidate(detection, distance);
  if (state.candidate.frames < AUTO_CAPTURE.changeFrames) {
    return;
  }

  await saveNewEpoch(detection);
}

function registerTransition(detection) {
  if (!state.pageClusters.length) {
    resetCandidate();
    return;
  }

  const currentCluster = getCurrentCluster();
  const distance = currentCluster && detection.signature
    ? clusterDistance(currentCluster, detection.signature)
    : null;
  const lowPaperConfidence = (detection.paperPresence || 0) < 0.45;
  const severeBlur = detection.quality < 38 || detection.sharpness < 8;
  const displacedMaterial = distance &&
    distance.representative > 0.38 &&
    distance.median > 0.28;
  const likelyPageTurn = !detection.found ||
    lowPaperConfidence ||
    (detection.quality < 52 && severeBlur && (lowPaperConfidence || displacedMaterial));

  if (likelyPageTurn) {
    state.transitionFrames += 1;
    resetCandidate();
  } else {
    state.transitionFrames = Math.max(0, state.transitionFrames - 1);
  }
}

function getCurrentCluster() {
  return state.currentPageIndex >= 0 ? state.pageClusters[state.currentPageIndex] : null;
}

function updateCandidate(detection, distance) {
  const score = captureScore(detection);

  if (!state.candidate) {
    state.candidate = {
      frames: 1,
      signatures: [detection.signature],
      bestSignature: detection.signature,
      bestScore: score,
      distance
    };
    return;
  }

  const drift = signatureSetDistance(state.candidate.signatures, detection.signature).min;
  if (drift > AUTO_CAPTURE.candidateMaxDrift) {
    state.candidate = {
      frames: 1,
      signatures: [detection.signature],
      bestSignature: detection.signature,
      bestScore: score,
      distance
    };
    return;
  }

  state.candidate.frames += 1;
  state.candidate.distance = distance;
  addSignatureToObject(state.candidate, detection.signature);
  if (score > state.candidate.bestScore) {
    state.candidate.bestScore = score;
    state.candidate.bestSignature = detection.signature;
  }
}

function isSameEpoch(distance) {
  return distance.min <= AUTO_CAPTURE.sameThreshold ||
    (
      distance.representative <= AUTO_CAPTURE.sameLooseThreshold &&
      distance.median <= AUTO_CAPTURE.sameMedianThreshold &&
      state.transitionFrames < AUTO_CAPTURE.turnFrames
    );
}

function isSameReplacement(distance) {
  return distance.min <= AUTO_CAPTURE.sameThreshold ||
    (
      distance.representative <= AUTO_CAPTURE.sameLooseThreshold &&
      distance.median <= AUTO_CAPTURE.sameMedianThreshold
    );
}

function isMaterialChange(distance) {
  const currentCluster = getCurrentCluster();
  const minEpochMs = state.sourceMode === "upload" ? AUTO_CAPTURE.uploadMinEpochMs : AUTO_CAPTURE.minEpochMs;
  const epochAge = currentCluster?.startedAtMs
    ? getSourceElapsedMs() - currentCluster.startedAtMs
    : currentCluster?.startedAt
      ? performance.now() - currentCluster.startedAt
      : 0;

  if (epochAge < minEpochMs) {
    return false;
  }

  if (state.transitionFrames >= AUTO_CAPTURE.turnFrames) {
    return distance.representative >= AUTO_CAPTURE.afterTransitionThreshold ||
      distance.median >= AUTO_CAPTURE.afterTransitionThreshold;
  }

  return distance.representative >= AUTO_CAPTURE.hardChangeThreshold &&
    distance.median >= 0.36;
}

async function saveNewEpoch(detection) {
  const provisional = true;
  const page = await captureCurrentPage("auto", { provisional });
  if (!page) {
    return;
  }

  const signature = page.reviewSignature || detection.signature;
  const signatures = state.candidate?.signatures?.length
    ? [...state.candidate.signatures, signature]
    : [signature];
  const cluster = {
    signatures: boundedSignatures(signatures),
    bestSignature: signature,
    bestScore: page.reviewScore ?? captureScore(detection),
    startedAt: performance.now(),
    startedAtMs: getSourceElapsedMs(),
    quality: page.reviewQuality ?? detection.quality,
    sharpness: page.reviewSharpness ?? detection.sharpness,
    paperPresence: page.reviewPaperPresence ?? detection.paperPresence ?? 0
  };
  state.pageClusters.push(cluster);
  state.currentPageIndex = state.pageClusters.length - 1;
  recordDebugEvent("new-epoch", {
    index: state.currentPageIndex,
    provisional,
    startedAtMs: Math.round(cluster.startedAtMs),
    quality: Math.round(cluster.quality || 0),
    sharpness: Number((cluster.sharpness || 0).toFixed(2)),
    paperPresence: Number((cluster.paperPresence || 0).toFixed(3))
  });
  syncCapturedSignatures();
  state.transitionFrames = 0;
  resetCandidate();
  state.cooldownUntil = performance.now() + AUTO_CAPTURE.cooldownMs;
  state.stableFrames = 0;
  reviewContextMemory({ force: true });
}

async function maybeReplaceCurrentPage(detection) {
  const currentCluster = getCurrentCluster();
  if (!currentCluster) {
    return;
  }

  const score = captureScore(detection);
  if (score <= currentCluster.bestScore + AUTO_CAPTURE.replaceMargin) {
    return;
  }

  const previousPage = state.pages[state.currentPageIndex];
  const previousBestScore = currentCluster.bestScore;
  const page = await captureCurrentPage("auto", { replaceIndex: state.currentPageIndex });
  if (!page) {
    return;
  }

  const reviewedScore = page.reviewScore ?? score;
  const signature = page.reviewSignature || detection.signature;
  const reviewedDistance = clusterDistance(currentCluster, signature);
  if (!isSameReplacement(reviewedDistance)) {
    state.pages[state.currentPageIndex] = previousPage;
    renderPages();
    recordDebugEvent("reject-replacement-change", {
      index: state.currentPageIndex,
      representative: Number(reviewedDistance.representative.toFixed(3)),
      median: Number(reviewedDistance.median.toFixed(3)),
      min: Number(reviewedDistance.min.toFixed(3))
    });
    return;
  }

  if (reviewedScore <= previousBestScore + AUTO_CAPTURE.replaceMargin) {
    addCandidateToPage(previousPage, page.localCandidate);
    state.pages[state.currentPageIndex] = previousPage;
    renderPages();
    recordDebugEvent("reject-replacement-score", {
      index: state.currentPageIndex,
      reviewedScore: Number(reviewedScore.toFixed(2)),
      previousBestScore: Number(previousBestScore.toFixed(2))
    });
    return;
  }

  currentCluster.bestScore = reviewedScore;
  currentCluster.bestSignature = signature;
  currentCluster.quality = page.reviewQuality ?? detection.quality;
  currentCluster.sharpness = page.reviewSharpness ?? detection.sharpness;
  currentCluster.paperPresence = page.reviewPaperPresence ?? detection.paperPresence ?? 0;
  addSignatureToCluster(currentCluster, signature);
  syncCapturedSignatures();
  state.cooldownUntil = performance.now() + AUTO_CAPTURE.cooldownMs;
  reviewContextMemory({ force: true });
}

function clusterDistance(cluster, signature) {
  const setDistance = signatureSetDistance(cluster.signatures, signature);
  return {
    ...setDistance,
    representative: cluster.bestSignature ? frameDifference(cluster.bestSignature, signature) : setDistance.min
  };
}

function signatureSetDistance(signatures, signature) {
  if (!signature || !signatures?.length) {
    return { min: 1, median: 1 };
  }

  const distances = signatures
    .filter(Boolean)
    .map((savedSignature) => frameDifference(savedSignature, signature))
    .sort((a, b) => a - b);

  if (!distances.length) {
    return { min: 1, median: 1 };
  }

  return {
    min: distances[0],
    median: distances[Math.floor(distances.length * 0.5)]
  };
}

function savedClusterDistance(signature, excludedIndex = -1) {
  const distances = state.pageClusters
    .map((cluster, index) => index === excludedIndex ? null : clusterDistance(cluster, signature))
    .filter(Boolean);

  if (!distances.length) {
    return { min: 1, median: 1, representative: 1 };
  }

  return distances.reduce((best, item) => item.min < best.min ? item : best, distances[0]);
}

function addSignatureToCluster(cluster, signature) {
  addSignatureToObject(cluster, signature);
}

function addSignatureToObject(target, signature) {
  if (!signature) {
    return;
  }

  target.signatures.push(signature);
  target.signatures = boundedSignatures(target.signatures);
}

function boundedSignatures(signatures) {
  return signatures.filter(Boolean).slice(-AUTO_CAPTURE.clusterSize);
}

function captureScore(detection) {
  return detection.quality +
    Math.min(42, detection.sharpness) * 1.1 +
    (detection.paperPresence || 0) * 12;
}

function maybeStoreLocalCandidate(detection, cluster, pageIndex) {
  const page = state.pages[pageIndex];
  if (!page || state.captureInProgress || !elements.video.videoWidth) {
    return;
  }

  const elapsedMs = getSourceElapsedMs();
  if (elapsedMs - (page.lastCandidateAtMs || 0) < AUTO_CAPTURE.candidateImageCooldownMs) {
    return;
  }

  if (detection.quality < AUTO_CAPTURE.candidateImageMinQuality) {
    return;
  }

  const score = captureScore(detection);
  if (score > (cluster.bestScore || 0) + AUTO_CAPTURE.replaceMargin) {
    return;
  }

  const distance = clusterDistance(cluster, detection.signature);
  if (!isSameReplacement(distance)) {
    return;
  }

  const worstScore = (page.candidates || [])
    .reduce((worst, candidate) => Math.min(worst, candidate.score || 0), Infinity);
  if ((page.candidates || []).length >= AUTO_CAPTURE.candidateImagePoolSize &&
    score <= worstScore + AUTO_CAPTURE.candidateImageScoreMargin) {
    return;
  }

  const candidatePage = capturePage({
    video: elements.video,
    sourceCanvas: elements.sourceCanvas,
    detection,
    pageNumber: page.number || pageIndex + 1
  });
  const review = analyzeStillCanvas(elements.sourceCanvas);
  if (!isUsefulFrameCandidate(review)) {
    return;
  }

  addCandidateToPage(page, createFrameCandidate(candidatePage, review, "local"));
  page.lastCandidateAtMs = elapsedMs;
}

function isUsefulFrameCandidate(review) {
  return review.quality >= AUTO_CAPTURE.candidateImageMinQuality &&
    review.sharpness >= 12 &&
    (review.paperPresence || 0) >= 0.5;
}

function createFrameCandidate(page, review, role) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    dataUrl: page.dataUrl,
    width: page.width,
    height: page.height,
    quality: review.quality,
    sharpness: review.sharpness,
    paperPresence: review.paperPresence || 0,
    score: captureScore(review),
    capturedAtMs: page.capturedAtMs ?? getSourceElapsedMs()
  };
}

function addCandidateToPage(page, candidate) {
  if (!page || !candidate) {
    return;
  }

  page.candidates = mergeCandidatePools(page.candidates, [candidate]);
}

function mergeCandidatePools(existing = [], additions = []) {
  const byImage = new Map();
  [...existing, ...additions].filter(Boolean).forEach((candidate) => {
    if (!candidate.dataUrl) {
      return;
    }

    const previous = byImage.get(candidate.dataUrl);
    if (!previous || (candidate.score || 0) > (previous.score || 0)) {
      byImage.set(candidate.dataUrl, candidate);
    }
  });

  return [...byImage.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, AUTO_CAPTURE.candidateImagePoolSize);
}

function resetCandidate() {
  state.candidate = null;
}

function syncCapturedSignatures() {
  state.capturedSignatures = state.pageClusters
    .map((cluster) => cluster.bestSignature || cluster.signatures.at(-1))
    .filter(Boolean)
    .slice(-12);
}

function getVisiblePages() {
  return state.pages.filter((page) => !page.provisional);
}

function getVisiblePageCount() {
  return getVisiblePages().length;
}

function getSourceElapsedMs() {
  if (state.sourceMode === "upload" && elements.video.duration) {
    return Math.max(0, ((elements.video.currentTime || 0) - state.scanStartedVideoTime) * 1000);
  }

  if (!state.scanStartedAt) {
    return 0;
  }

  return performance.now() - state.scanStartedAt;
}

function isContextReady() {
  return state.contextReady || getSourceElapsedMs() >= AUTO_CAPTURE.contextWarmupMs;
}

function reviewContextMemory(options = {}) {
  if (!state.pages.length || state.captureInProgress) {
    return;
  }

  const elapsedMs = getSourceElapsedMs();
  if (!options.force && elapsedMs - state.lastContextReviewAt < AUTO_CAPTURE.contextReviewMs) {
    return;
  }
  state.lastContextReviewAt = elapsedMs;

  if (options.final || elapsedMs >= AUTO_CAPTURE.contextWarmupMs) {
    state.contextReady = true;
  }

  if (!state.contextReady) {
    return;
  }

  const pruned = pruneContextEpochs(options);
  const promoted = promoteContextEpochs();

  if (pruned || promoted) {
    syncCapturedSignatures();
    renderPages();
  }
}

function promoteContextEpochs() {
  let promoted = false;

  state.pages.forEach((page, index) => {
    if (!page.provisional) {
      return;
    }

    const cluster = state.pageClusters[index];
    if (!isPromotableEpoch(cluster)) {
      return;
    }

    if (isEarlyUploadEpoch(index)) {
      return;
    }

    page.provisional = false;
    promoted = true;
    recordDebugEvent("promote", {
      index,
      elapsedMs: Math.round(getSourceElapsedMs()),
      quality: Math.round(cluster.quality || 0),
      sharpness: Number((cluster.sharpness || 0).toFixed(2)),
      paperPresence: Number((cluster.paperPresence || 0).toFixed(3))
    });
  });

  return promoted;
}

function pruneContextEpochs(options = {}) {
  const drop = new Set();

  state.pageClusters.forEach((cluster, index) => {
    const page = state.pages[index];
    if (!cluster || !page) {
      drop.add(index);
      recordDebugEvent("drop-missing", { index });
      return;
    }

    const provisionalAge = getSourceElapsedMs() - (cluster.startedAtMs || 0);
    const reviewExpired = options.final || provisionalAge >= AUTO_CAPTURE.provisionalReviewMs;
    if (page.provisional && (state.contextReady || options.final) && reviewExpired && !isPromotableEpoch(cluster)) {
      drop.add(index);
      recordDebugEvent("drop-weak", {
        index,
        elapsedMs: Math.round(getSourceElapsedMs()),
        quality: Math.round(cluster.quality || 0),
        sharpness: Number((cluster.sharpness || 0).toFixed(2)),
        paperPresence: Number((cluster.paperPresence || 0).toFixed(3))
      });
    }

    if (page.provisional && isEarlyUploadEpoch(index) && hasLaterPromotableEpoch(index)) {
      drop.add(index);
      recordDebugEvent("drop-initial-context", {
        index,
        elapsedMs: Math.round(getSourceElapsedMs()),
        startedAtMs: Math.round(cluster.startedAtMs || 0)
      });
    }
  });

  for (let firstIndex = 0; firstIndex < state.pageClusters.length; firstIndex += 1) {
    if (drop.has(firstIndex)) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < state.pageClusters.length; secondIndex += 1) {
      if (drop.has(secondIndex)) {
        continue;
      }

      const first = state.pageClusters[firstIndex];
      const second = state.pageClusters[secondIndex];
      if (!areDuplicateEpochs(first, second)) {
        continue;
      }

      const droppedIndex = pickWeakerEpochIndex(firstIndex, secondIndex);
      drop.add(droppedIndex);
      recordDebugEvent("drop-duplicate", {
        firstIndex,
        secondIndex,
        droppedIndex,
        elapsedMs: Math.round(getSourceElapsedMs())
      });
    }
  }

  if (!drop.size) {
    return false;
  }

  removeEpochs(drop);
  return true;
}

function isPromotableEpoch(cluster) {
  return Boolean(cluster?.bestSignature) &&
    (cluster.quality || 0) >= AUTO_CAPTURE.promoteMinQuality &&
    (cluster.sharpness || 0) >= AUTO_CAPTURE.promoteMinSharpness &&
    (cluster.paperPresence || 0) >= AUTO_CAPTURE.promoteMinPaperPresence;
}

function isEarlyUploadEpoch(index) {
  if (state.sourceMode !== "upload") {
    return false;
  }

  const cluster = state.pageClusters[index];
  return Boolean(cluster) && (cluster.startedAtMs || 0) < AUTO_CAPTURE.uploadInitialIgnoreMs;
}

function hasLaterPromotableEpoch(index) {
  return state.pageClusters
    .slice(index + 1)
    .some((cluster) => isPromotableEpoch(cluster));
}

function areDuplicateEpochs(first, second) {
  if (!first?.bestSignature || !second?.bestSignature) {
    return false;
  }

  const firstToSecond = clusterDistance(first, second.bestSignature);
  const secondToFirst = clusterDistance(second, first.bestSignature);
  const min = Math.min(firstToSecond.min, secondToFirst.min);
  const representative = Math.min(firstToSecond.representative, secondToFirst.representative);
  const median = Math.min(firstToSecond.median, secondToFirst.median);

  return min <= AUTO_CAPTURE.duplicatePruneThreshold ||
    (
      representative <= AUTO_CAPTURE.duplicatePruneRepresentativeThreshold &&
      median <= AUTO_CAPTURE.duplicatePruneMedianThreshold
    );
}

function pickWeakerEpochIndex(firstIndex, secondIndex) {
  const first = state.pageClusters[firstIndex];
  const second = state.pageClusters[secondIndex];
  const firstScore = first.bestScore || 0;
  const secondScore = second.bestScore || 0;

  if (Math.abs(firstScore - secondScore) > 3) {
    return firstScore < secondScore ? firstIndex : secondIndex;
  }

  return firstIndex;
}

function removeEpochs(drop) {
  const oldCurrent = state.currentPageIndex;
  state.pages = state.pages.filter((_, index) => !drop.has(index));
  state.pageClusters = state.pageClusters.filter((_, index) => !drop.has(index));

  if (!state.pageClusters.length) {
    state.currentPageIndex = -1;
    return;
  }

  if (drop.has(oldCurrent)) {
    state.currentPageIndex = state.pageClusters.length - 1;
    return;
  }

  let removedBeforeCurrent = 0;
  drop.forEach((index) => {
    if (index < oldCurrent) {
      removedBeforeCurrent += 1;
    }
  });
  state.currentPageIndex = Math.max(0, oldCurrent - removedBeforeCurrent);
}

function recordDebugEvent(type, payload = {}) {
  if (!debugEnabled || !window.paperSweepDebug) {
    return;
  }

  window.paperSweepDebug.events.push({
    type,
    sourceMode: state.sourceMode,
    elapsedMs: Math.round(getSourceElapsedMs()),
    pageCount: state.pages.length,
    visibleCount: getVisiblePageCount(),
    currentPageIndex: state.currentPageIndex,
    transitionFrames: state.transitionFrames,
    ...payload
  });
}

async function captureCurrentPage(mode, options = {}) {
  if (!elements.video.videoWidth || state.captureInProgress) {
    return null;
  }

  state.captureInProgress = true;

  try {
    const replaceIndex = Number.isInteger(options.replaceIndex) ? options.replaceIndex : -1;
    const detection = state.lastDetection;
    const page = capturePage({
      video: elements.video,
      sourceCanvas: elements.sourceCanvas,
      detection,
      pageNumber: replaceIndex >= 0 ? replaceIndex + 1 : state.pages.length + 1
    });
    const review = analyzeStillCanvas(elements.sourceCanvas);
    page.mode = mode;
    page.provisional = options.provisional ?? state.pages[replaceIndex]?.provisional ?? false;
    page.reviewSignature = review.signature;
    page.reviewQuality = review.quality;
    page.reviewSharpness = review.sharpness;
    page.reviewPaperPresence = review.paperPresence || 0;
    page.reviewScore = captureScore(review);
    page.capturedAtMs = getSourceElapsedMs();
    page.localCandidate = createFrameCandidate(page, review, replaceIndex >= 0 ? "replacement" : "selected");
    page.candidates = mergeCandidatePools(
      replaceIndex >= 0 ? state.pages[replaceIndex]?.candidates : [],
      [page.localCandidate]
    );
    page.lastCandidateAtMs = page.capturedAtMs;
    recordDebugEvent("capture", {
      replaceIndex,
      provisional: page.provisional,
      capturedAtMs: Math.round(page.capturedAtMs),
      detectionQuality: detection?.quality ?? 0,
      detectionSharpness: Number((detection?.sharpness ?? 0).toFixed(2)),
      detectionPaperPresence: Number((detection?.paperPresence ?? 0).toFixed(3)),
      reviewQuality: review.quality,
      reviewSharpness: Number(review.sharpness.toFixed(2)),
      reviewPaperPresence: Number((review.paperPresence || 0).toFixed(3))
    });

    if (replaceIndex >= 0 && state.pages[replaceIndex]) {
      state.pages[replaceIndex] = page;
    } else {
      state.pages.push(page);
    }

    renderPages();
    setScanState(page.provisional ? "Reviewing" : "Captured");
    const visibleCount = getVisiblePageCount();
    setStatus(page.provisional
      ? "Building context. Candidate document held for review."
      : replaceIndex >= 0
        ? "Updated a saved document with a sharper frame."
        : `Saved document ${visibleCount}. Keep going.`);
    return page;
  } catch (error) {
    setStatus(`Could not save this document: ${error.message}`);
    return null;
  } finally {
    state.captureInProgress = false;
  }
}

function exportCurrentPdf() {
  try {
    const pages = getVisiblePages();
    exportPagesToPdf(pages);
    setStatus(`Exported ${pages.length} document${pages.length === 1 ? "" : "s"} as PDF.`);
  } catch (error) {
    setStatus(`Could not export PDF: ${error.message}`);
  }
}

async function exportCurrentZip() {
  try {
    const pages = getVisiblePages();
    elements.exportZip.disabled = true;
    setStatus("Preparing ZIP export...");
    await exportPagesToZip(pages);
    setStatus(`Exported ${pages.length} document${pages.length === 1 ? "" : "s"} with PDF, images, and candidates.`);
  } catch (error) {
    setStatus(`Could not export ZIP: ${error.message}`);
  } finally {
    elements.exportZip.disabled = getVisiblePageCount() === 0;
  }
}

function clearPages() {
  state.pages = [];
  state.capturedSignatures = [];
  state.pageClusters = [];
  state.currentPageIndex = -1;
  state.contextReady = false;
  resetCandidate();
  renderPages();
  setStatus("Saved documents cleared.");
}

async function startBenchmarkRecording() {
  if (!window.MediaRecorder) {
    setStatus("This browser cannot record benchmark video.");
    return;
  }

  try {
    clearBenchmarkDownloads();

    if (state.sourceMode === "upload") {
      stopActiveSource({ keepStatus: true });
    }

    if (!state.stream) {
      await openBenchmarkCamera();
    }

    const mimeType = getRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(state.stream, { mimeType })
      : new MediaRecorder(state.stream);

    state.benchmarking = true;
    state.benchmark = {
      recorder,
      chunks: [],
      markers: [],
      page: 0,
      startedAt: performance.now(),
      mimeType: recorder.mimeType || mimeType || "video/webm",
      timer: window.setInterval(updateBenchmarkTimer, 250),
      videoUrl: null,
      labelsUrl: null
    };

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) {
        state.benchmark.chunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", finalizeBenchmarkRecording, { once: true });
    recorder.start(250);

    elements.benchmarkPanel.hidden = false;
    elements.benchmarkStart.disabled = true;
    elements.start.disabled = true;
    elements.uploadInput.disabled = true;
    elements.uploadLabel.setAttribute("aria-disabled", "true");
    elements.stop.disabled = false;
    elements.viewer.classList.add("is-live");
    setScanState("Benchmark");
    updateBenchmarkHud();
    setStatus("Benchmark recording. Tap Page ready each time a new page is settled.");
    updateControlVisibility();

    if (!state.running) {
      beginScanning("benchmark");
    }
  } catch (error) {
    state.benchmarking = false;
    state.benchmark = null;
    elements.benchmarkPanel.hidden = true;
    elements.benchmarkStart.disabled = false;
    elements.start.disabled = false;
    setUploadEnabled(true);
    setStatus(`Benchmark recording failed: ${error.message}`);
    updateControlVisibility();
  }
}

async function openBenchmarkCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this browser.");
  }

  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    throw new Error("Camera access needs HTTPS or localhost.");
  }

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  });
  elements.video.srcObject = state.stream;
  await elements.video.play();
  syncOverlaySize();
}

function markBenchmarkPage() {
  if (!state.benchmarking || !state.benchmark) {
    return;
  }

  state.benchmark.page += 1;
  const elapsedMs = Math.round(performance.now() - state.benchmark.startedAt);
  state.benchmark.markers.push({
    page: state.benchmark.page,
    timeMs: elapsedMs,
    timeSeconds: Number((elapsedMs / 1000).toFixed(3)),
    videoWidth: elements.video.videoWidth || 0,
    videoHeight: elements.video.videoHeight || 0,
    snapshotJpeg: captureBenchmarkSnapshot()
  });
  updateBenchmarkHud();
  setStatus(`Marked page ${state.benchmark.page}. Keep recording or stop benchmark.`);
}

function stopBenchmarkRecording(options = {}) {
  if (!state.benchmarking || !state.benchmark) {
    return;
  }

  state.benchmarking = false;
  state.running = false;
  state.sourceMode = state.stream ? "camera-preview" : null;
  window.clearInterval(state.benchmark.timer);
  elements.benchmarkPanel.hidden = true;
  elements.benchmarkStart.disabled = false;
  elements.start.disabled = state.stream ? true : false;
  clearOverlay();
  setScanState("Stopped");
  setUploadEnabled(true);

  if (state.benchmark.recorder.state !== "inactive") {
    state.benchmark.recorder.stop();
  }

  if (!options.keepStatus) {
    setStatus("Preparing benchmark downloads...");
  }
  updateControlVisibility();
}

function finalizeBenchmarkRecording() {
  if (!state.benchmark) {
    return;
  }

  const timestamp = formatTimestamp(new Date());
  const videoExtension = state.benchmark.mimeType.includes("mp4") ? "mp4" : "webm";
  const videoFileName = `paper-sweep-benchmark-${timestamp}.${videoExtension}`;
  const labelsFileName = `paper-sweep-benchmark-${timestamp}.json`;
  const videoBlob = new Blob(state.benchmark.chunks, { type: state.benchmark.mimeType });
  const labels = {
    app: "Paper Sweep",
    kind: "page-ready-benchmark",
    createdAt: new Date().toISOString(),
    videoFileName,
    markerCount: state.benchmark.markers.length,
    markers: state.benchmark.markers,
    notes: "Page numbers are marked when the page is settled and ready on screen. Page 0 means no marked page yet."
  };
  const labelsBlob = new Blob([JSON.stringify(labels, null, 2)], { type: "application/json" });

  state.benchmark.videoUrl = URL.createObjectURL(videoBlob);
  state.benchmark.labelsUrl = URL.createObjectURL(labelsBlob);
  elements.benchmarkVideoDownload.href = state.benchmark.videoUrl;
  elements.benchmarkVideoDownload.download = videoFileName;
  elements.benchmarkLabelDownload.href = state.benchmark.labelsUrl;
  elements.benchmarkLabelDownload.download = labelsFileName;
  elements.benchmarkDownloads.hidden = false;
  setStatus(`Benchmark ready: ${state.benchmark.markers.length} page marker${state.benchmark.markers.length === 1 ? "" : "s"} saved.`);
}

function captureBenchmarkSnapshot() {
  const sourceWidth = elements.video.videoWidth || 0;
  const sourceHeight = elements.video.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const maxLongSide = 720;
  const scale = Math.min(1, maxLongSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  canvas.getContext("2d").drawImage(elements.video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.74);
}

function updateBenchmarkTimer() {
  if (!state.benchmarking || !state.benchmark) {
    return;
  }

  updateBenchmarkHud();
}

function updateBenchmarkHud() {
  if (!state.benchmark) {
    elements.benchmarkPage.textContent = "0";
    elements.benchmarkTime.textContent = "00:00";
    return;
  }

  const elapsedSeconds = Math.floor((performance.now() - state.benchmark.startedAt) / 1000);
  elements.benchmarkPage.textContent = state.benchmark.page.toString();
  elements.benchmarkTime.textContent = formatDuration(elapsedSeconds);
}

function clearBenchmarkDownloads() {
  if (state.benchmark?.videoUrl) {
    URL.revokeObjectURL(state.benchmark.videoUrl);
  }
  if (state.benchmark?.labelsUrl) {
    URL.revokeObjectURL(state.benchmark.labelsUrl);
  }
  elements.benchmarkDownloads.hidden = true;
  elements.benchmarkVideoDownload.removeAttribute("href");
  elements.benchmarkLabelDownload.removeAttribute("href");
}

function getRecordingMimeType() {
  const types = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function renderPages() {
  elements.pages.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const visibleEntries = state.pages
    .map((page, realIndex) => ({ page, realIndex }))
    .filter((entry) => !entry.page.provisional);

  visibleEntries.forEach(({ page, realIndex }, index) => {
    page.number = index + 1;
    const card = document.createElement("article");
    card.className = "page-card";
    card.innerHTML = `
      <img src="${page.dataUrl}" alt="Saved document ${page.number}">
      <div>
        <h3>Document ${page.number}</h3>
        <p>${page.width} x ${page.height}px · ${candidateLabel(page)}</p>
      </div>
      <button class="icon-button" type="button" aria-label="Delete document ${page.number}">
        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.pages.splice(realIndex, 1);
      state.pageClusters.splice(realIndex, 1);
      if (!state.pageClusters.length) {
        state.currentPageIndex = -1;
      } else if (state.currentPageIndex >= realIndex) {
        state.currentPageIndex = Math.max(0, state.currentPageIndex - 1);
      }
      syncCapturedSignatures();
      renderPages();
      setStatus(`Deleted document ${index + 1}.`);
    });
    fragment.append(card);
  });

  elements.pages.append(fragment);
  elements.pageCount.textContent = visibleEntries.length;
  elements.pageCountLarge.textContent = visibleEntries.length;
  elements.exportPdf.disabled = visibleEntries.length === 0;
  elements.exportZip.disabled = visibleEntries.length === 0;
  elements.clear.disabled = state.pages.length === 0;
  updateControlVisibility();
}

function candidateLabel(page) {
  const alternates = (page.candidates || [])
    .filter((candidate) => candidate.dataUrl && candidate.dataUrl !== page.dataUrl)
    .filter((candidate) => candidate.quality >= 52 && candidate.sharpness >= 12)
    .length;
  return alternates ? `${alternates} local candidate${alternates === 1 ? "" : "s"}` : "Saved";
}

function updateMetrics(detection, changed = 1) {
  if (!detection) {
    elements.metricDocument.textContent = "Waiting";
    elements.metricQuality.textContent = "0%";
    elements.metricSharpness.textContent = "0";
    elements.metricChange.textContent = "New";
    elements.qualityMeter.style.width = "0%";
    setScanState("Idle");
    return;
  }

  updateMetricValues(detection, changed);

  if (detection.ready) {
    setScanState(isContextReady() ? "Ready" : "Reviewing");
    const currentCluster = getCurrentCluster();
    if (!isContextReady()) {
      setStatus("Building context. Clear page candidates are held before saving.");
    } else if (!currentCluster) {
      setStatus("Stable page candidate. Confirming before saving.");
    } else if (isSameEpoch(clusterDistance(currentCluster, detection.signature))) {
      setStatus("Same document. Keeping the sharpest frame.");
    } else if (state.candidate) {
      setStatus("New page candidate. Confirming over time.");
    } else {
      setStatus("Watching for a truly new page.");
    }
  } else if (detection.found) {
    setScanState("Reading");
    setStatus("This frame is too soft. Waiting for a sharper one.");
  } else {
    setScanState("Scanning");
    setStatus("Watching for a sharp changed document.");
  }
}

function updateMetricValues(detection, changed = 1) {
  elements.metricDocument.textContent = detection.ready ? "Sharp" : "Blurry";
  elements.metricQuality.textContent = `${detection.quality}%`;
  elements.metricSharpness.textContent = Math.round(detection.sharpness).toString();
  elements.metricChange.textContent = state.capturedSignatures.length ? `${Math.round(changed * 100)}%` : "New";
  elements.qualityMeter.style.width = `${detection.quality}%`;
}

function drawOverlay(detection, stableFrames) {
  syncOverlaySize();
  const canvas = elements.overlay;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!detection?.points) {
    return;
  }

  const ready = detection.ready && stableFrames >= AUTO_CAPTURE.stableFrames;
  context.lineWidth = Math.max(4, canvas.width / 260);
  context.strokeStyle = ready ? "rgba(86, 196, 132, 0.95)" : "rgba(216, 155, 61, 0.95)";
  context.fillStyle = ready ? "rgba(86, 196, 132, 0.14)" : "rgba(216, 155, 61, 0.12)";
  context.beginPath();
  detection.points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.fill();
  context.stroke();

  detection.points.forEach((point) => {
    context.beginPath();
    context.arc(point.x, point.y, Math.max(6, canvas.width / 150), 0, Math.PI * 2);
    context.fillStyle = ready ? "rgba(86, 196, 132, 1)" : "rgba(216, 155, 61, 1)";
    context.fill();
  });
}

function syncOverlaySize() {
  const width = elements.video.videoWidth || 1280;
  const height = elements.video.videoHeight || 720;
  if (elements.overlay.width !== width || elements.overlay.height !== height) {
    elements.overlay.width = width;
    elements.overlay.height = height;
  }
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not read this video file."));
    };

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.load();
  });
}

function clearOverlay() {
  const context = elements.overlay.getContext("2d");
  context.clearRect(0, 0, elements.overlay.width, elements.overlay.height);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setScanState(message) {
  elements.scanState.textContent = message;
}

function setUploadEnabled(enabled) {
  elements.uploadInput.disabled = !enabled;
  elements.uploadLabel.setAttribute("aria-disabled", enabled ? "false" : "true");
}

function updateControlVisibility() {
  const active = state.running || state.benchmarking;
  const hasPages = getVisiblePageCount() > 0;

  elements.start.hidden = active;
  elements.uploadLabel.hidden = active;
  elements.stop.hidden = !active;
  elements.viewer.hidden = !active;
  elements.metrics.hidden = !active;
  elements.pagesPanel.hidden = !hasPages;
  elements.exportActions.hidden = !hasPages;
  elements.clear.hidden = !hasPages;

  elements.exportPdf.disabled = !hasPages;
  elements.exportZip.disabled = !hasPages;
  elements.clear.disabled = state.pages.length === 0;
  elements.benchmarkStart.disabled = active;
}

function differenceFromRecentCaptures(signature) {
  if (!signature) {
    return 1;
  }

  const currentCluster = getCurrentCluster();
  if (currentCluster) {
    return clusterDistance(currentCluster, signature).representative;
  }

  if (!state.capturedSignatures.length) {
    return 1;
  }
  return frameDifference(state.capturedSignatures[state.capturedSignatures.length - 1], signature);
}

function runVisionSelfTest() {
  const first = drawSyntheticPage("first");
  const second = drawSyntheticPage("second");
  const firstResult = analyzeStillCanvas(first);
  const secondResult = analyzeStillCanvas(second);
  const same = frameDifference(firstResult.signature, firstResult.signature);
  const changed = frameDifference(firstResult.signature, secondResult.signature);
  const passed = firstResult.ready && secondResult.ready && same < 0.02 && changed > 0.14;

  console.info("Paper Sweep vision self-test", {
    firstFound: firstResult.found,
    secondFound: secondResult.found,
    same,
    changed,
    firstQuality: firstResult.quality,
    secondQuality: secondResult.quality
  });

  return {
    passed,
    message: passed ? "Synthetic change test passed." : "Synthetic change test is weak; use bright paper on a contrasting surface."
  };
}

function maybeRunBenchmark() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("benchmark")) {
    return;
  }

  const count = Number(params.get("samples") || 24);
  window.setTimeout(async () => {
    try {
      setStatus("Rendering 3D document benchmark...");
      const result = await runSimulationDatasetBenchmark({
        count: Number.isFinite(count) ? count : 24,
        seed: 1209
      });
      const output = document.createElement("script");
      output.type = "application/json";
      output.id = "paperSweepBenchmarkResult";
      output.textContent = JSON.stringify(result);
      document.body.append(output);
      console.info("Paper Sweep dataset benchmark", result);
      setStatus(
        `Benchmark: ${Math.round(result.materialChangeRecall * 100)}% page-change recall, ` +
        `${Math.round(result.sameTransformRejectionRate * 100)}% movement rejection.`
      );
    } catch (error) {
      setStatus(`Benchmark failed: ${error.message}`);
    }
  }, 60);
}

function drawSyntheticPage(variant) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 960;
  const context = canvas.getContext("2d");

  context.fillStyle = "#4d5a54";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(360, 480);
  context.rotate(-0.045);
  context.fillStyle = "#f7f5ee";
  context.fillRect(-245, -325, 490, 650);
  context.fillStyle = "#28342f";
  context.font = "700 34px Nunito, sans-serif";
  context.fillText(variant === "first" ? "Essay A" : "Essay B", -190, -250);
  context.font = "22px Nunito, sans-serif";

  for (let row = 0; row < 12; row += 1) {
    const y = -185 + row * 38;
    const width = variant === "first"
      ? 290 + ((row * 17) % 120)
      : 180 + ((row * 43) % 210);
    context.fillRect(-190, y, width, 6);
  }

  context.strokeStyle = variant === "first" ? "#ad6555" : "#557a69";
  context.lineWidth = 5;
  context.strokeRect(-205, 190, variant === "first" ? 130 : 210, 58);
  context.restore();

  return canvas;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
