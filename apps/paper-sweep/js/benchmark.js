import { createRenderedBookDataset } from "./simulation.js?v=simulation-10";
import { analyzeStillCanvas, frameDifference, frameDifferenceDetails } from "./vision.js?v=epoch-8";

const CHANGE_THRESHOLD = 0.18;

export async function runSimulationDatasetBenchmark(options = {}) {
  const count = options.count ?? 72;
  const seed = options.seed ?? 1209;
  const samples = await createRenderedBookDataset({ count, seed });
  const results = samples.map((sample) => ({
    ...sample,
    result: analyzeStillCanvas(sample.canvas)
  }));
  const contentSamples = results.filter((sample) => sample.hasContent);
  const transitionSamples = results.filter((sample) => !sample.hasContent);
  const readyFrames = contentSamples.filter((sample) => sample.result.ready);
  const transitionFalsePositives = transitionSamples.filter((sample) => sample.result.ready);
  const captureResults = simulateCapture(results, CHANGE_THRESHOLD);
  const newMaterialFrames = captureResults.filter((frame) => frame.expectedCapture);
  const sameTransformFrames = captureResults.filter((frame) => !frame.expectedCapture);
  const changedHits = newMaterialFrames.filter((frame) => frame.predictedCapture);
  const sameCorrect = sameTransformFrames.filter((frame) => !frame.predictedCapture);

  return {
    dataset: "threejs-rendered-book-video-simulation",
    seed,
    count: samples.length,
    threshold: CHANGE_THRESHOLD,
    readyFrameRate: ratio(readyFrames.length, contentSamples.length),
    transitionFalsePositiveRate: ratio(transitionFalsePositives.length, transitionSamples.length),
    materialChangeRecall: ratio(changedHits.length, newMaterialFrames.length),
    sameTransformRejectionRate: ratio(sameCorrect.length, sameTransformFrames.length),
    medianQuality: median(contentSamples.map((sample) => sample.result.quality)),
    medianSharpness: Math.round(median(contentSamples.map((sample) => sample.result.sharpness))),
    differenceStats: {
      changed: summarize(newMaterialFrames.map((frame) => frame.difference)),
      sameTransform: summarize(sameTransformFrames.map((frame) => frame.difference))
    },
    thresholdCurve: [0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.24].map((threshold) => summarizeThreshold(results, threshold)),
    totals: {
      renderedFrames: samples.length,
      contentFrames: contentSamples.length,
      transitionFrames: transitionSamples.length,
      readyFrames: readyFrames.length,
      transitionFalsePositives: transitionFalsePositives.length,
      newMaterialFrames: newMaterialFrames.length,
      changedHits: changedHits.length,
      sameTransformFrames: sameTransformFrames.length,
      sameTransformCorrect: sameCorrect.length
    },
    transformFalseNewCases: sameTransformFrames
      .filter((frame) => frame.predictedCapture)
      .slice(0, 8),
    missedChangeCases: newMaterialFrames
      .filter((frame) => !frame.predictedCapture)
      .slice(0, 8),
    weakFrames: contentSamples
      .filter((sample) => !sample.result.ready)
      .slice(0, 8)
      .map((sample) => ({
        id: sample.id,
        pageId: sample.pageId,
        variant: sample.variant,
        quality: sample.result.quality,
        sharpness: Math.round(sample.result.sharpness),
        blur: sample.blur,
        scale: sample.scale,
        lighting: sample.lighting
      }))
  };
}

export const runSyntheticDatasetBenchmark = runSimulationDatasetBenchmark;

function simulateCapture(results, threshold) {
  const accepted = [];
  const acceptedPageIds = new Set();
  const frames = [];

  for (let index = 0; index < results.length; index += 1) {
    const current = results[index];

    if (!current.hasContent || !current.result.ready || !current.result.signature) {
      continue;
    }

    const lastAccepted = accepted[accepted.length - 1];
    const difference = lastAccepted
      ? frameDifference(lastAccepted.signature, current.result.signature)
      : 1;
    const closest = lastAccepted
      ? {
        pageId: lastAccepted.pageId,
        ...frameDifferenceDetails(lastAccepted.signature, current.result.signature)
      }
      : null;
    const expectedCapture = !acceptedPageIds.has(current.pageId);
    const predictedCapture = !accepted.length || difference >= threshold;
    const frame = {
      currentId: current.id,
      currentPageId: current.pageId,
      currentVariant: current.variant,
      currentScale: current.scale,
      currentCameraZ: current.cameraZ,
      currentTranslation: current.translation,
      currentBlur: current.blur,
      expectedCapture,
      predictedCapture,
      difference,
      closest
    };

    frames.push(frame);

    if (predictedCapture) {
      accepted.push({
        pageId: current.pageId,
        signature: current.result.signature
      });
      if (expectedCapture) {
        acceptedPageIds.add(current.pageId);
      }
    }
  }

  return frames;
}

function summarizeThreshold(results, threshold) {
  const frames = simulateCapture(results, threshold);
  const newMaterialFrames = frames.filter((frame) => frame.expectedCapture);
  const sameTransformFrames = frames.filter((frame) => !frame.expectedCapture);
  const changedHits = newMaterialFrames.filter((frame) => frame.predictedCapture);
  const sameCorrect = sameTransformFrames.filter((frame) => !frame.predictedCapture);

  return {
    threshold,
    materialChangeRecall: ratio(changedHits.length, newMaterialFrames.length),
    sameTransformRejectionRate: ratio(sameCorrect.length, sameTransformFrames.length)
  };
}

function summarize(values) {
  if (!values.length) {
    return { min: 0, median: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: Number(sorted[0].toFixed(3)),
    median: Number(median(sorted).toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3))
  };
}

function median(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(value, total) {
  return total ? Number((value / total).toFixed(3)) : 0;
}
