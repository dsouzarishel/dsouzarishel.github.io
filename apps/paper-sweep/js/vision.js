const DEFAULT_OPTIONS = {
  analysisWidth: 240,
  minQuality: 52,
  minSharpness: 14,
  minContrast: 10
};

export function createFrameAnalyzer(canvas, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const context = canvas.getContext("2d", { willReadFrequently: true });

  function analyze(video) {
    if (!video.videoWidth || !video.videoHeight) {
      return emptyResult("Video not ready");
    }

    const scale = Math.min(1, settings.analysisWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.drawImage(video, 0, 0, width, height);
    return analyzeCanvas(canvas, video.videoWidth, video.videoHeight, settings);
  }

  return { analyze };
}

export function analyzeStillCanvas(canvas, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const analysisCanvas = document.createElement("canvas");
  const scale = Math.min(1, settings.analysisWidth / canvas.width);
  analysisCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  analysisCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  analysisCanvas
    .getContext("2d", { willReadFrequently: true })
    .drawImage(canvas, 0, 0, analysisCanvas.width, analysisCanvas.height);

  return analyzeCanvas(analysisCanvas, canvas.width, canvas.height, settings);
}

export function frameDifference(a, b) {
  return frameDifferenceDetails(a, b).score;
}

export function frameDifferenceDetails(a, b) {
  if (!a || !b) {
    return {
      score: 1,
      convolutionDistance: 1,
      landmarkDistance: 1,
      templateDistance: 1,
      legacyScore: 1
    };
  }

  const lumaDistance = shiftedGridDistance(a.luma, b.luma);
  const textureDistance = shiftedGridDistance(a.texture, b.texture);
  const inkDistance = shiftedGridDistance(a.ink, b.ink);
  const rowDistance = shiftedSeriesDistance(a.rows, b.rows, 2);
  const columnDistance = shiftedSeriesDistance(a.columns, b.columns, 2);
  const hashDistance = hammingRatio(a.hash, b.hash);
  const lowHashDistance = hammingRatio(a.lowHash, b.lowHash);
  const inkHashDistance = hammingRatio(a.inkHash, b.inkHash);
  const convolutionDistance = pyramidDistance(a.pyramid, b.pyramid);
  const landmarkDistanceValue = landmarkDistance(a.landmarks, b.landmarks);
  const templateDistance = patchDistance(a.patch, b.patch);
  const regionMotion = regionMotionDistance(a.region, b.region);
  const warmDistance = transformedGridDistance(a.warm, b.warm);
  const saturationDistance = transformedGridDistance(a.saturation, b.saturation);
  const colorDistance = warmDistance * 0.58 + saturationDistance * 0.42;
  const textureScore = textureDistance * 0.62 + rowDistance * 0.23 + columnDistance * 0.15;
  const toneScore = lumaDistance * 0.7 + hashDistance * 0.3;
  const inkScore = inkDistance * 0.68 + rowDistance * 0.2 + columnDistance * 0.12;
  const perceptualScore = lowHashDistance * 0.45 + inkHashDistance * 0.55;
  const legacyScore = Math.max(
    inkScore * 1.02,
    textureScore * 0.92,
    toneScore * 0.68,
    inkScore * 0.64 + perceptualScore * 0.12 + toneScore * 0.24
  );

  const baseScore = clamp01(
    Math.min(
      convolutionDistance,
      landmarkDistanceValue * 0.72 + convolutionDistance * 0.28,
      templateDistance * 0.82 + convolutionDistance * 0.18
    ) * 0.82 +
    Math.min(legacyScore, convolutionDistance * 1.18) * 0.18
  );
  const colorLift = colorDistance > 0.08 ? clamp01((colorDistance - 0.08) / 0.36) * 0.18 : 0;
  const motionSuppression = regionMotion > 0.06 && baseScore < 0.29
    ? clamp01((regionMotion - 0.06) / 0.28) * 0.62
    : 0;
  const motionOnlyScore = baseScore * (1 - motionSuppression);
  const contentScore = baseScore * 0.82 + colorDistance * 0.44 + colorLift;
  const score = clamp01(Math.max(motionOnlyScore, contentScore));

  return {
    score,
    baseScore,
    colorDistance,
    convolutionDistance,
    landmarkDistance: landmarkDistanceValue,
    templateDistance,
    regionMotion,
    legacyScore
  };
}

export const pageDifference = frameDifference;

function analyzeCanvas(canvas, sourceWidth, sourceHeight, settings) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const frame = makeLumaFrame(imageData);
  const exposure = measureExposure(frame.gray);
  const sharpness = measureSharpness(frame.gray, frame.width, frame.height);
  const paper = measurePaperPresence(imageData, frame.gray, frame.width, frame.height);
  const signature = createChangeSignature(frame.gray, frame.width, frame.height, paper.region, imageData);
  const sharpnessScore = clamp01((sharpness - settings.minSharpness) / 18);
  const contrastScore = clamp01((exposure.contrast - settings.minContrast) / 34);
  const brightnessScore = 1 - Math.min(1, Math.abs(exposure.brightness - 132) / 128);
  const paperScore = clamp01((paper.score - 0.18) / 0.38);
  const quality = Math.round(100 * clamp01(
    sharpnessScore * 0.48 +
    contrastScore * 0.2 +
    brightnessScore * 0.12 +
    paperScore * 0.2
  ));
  const ready = quality >= settings.minQuality &&
    sharpness >= settings.minSharpness &&
    exposure.contrast >= settings.minContrast &&
    paper.present;

  return {
    found: paper.present,
    ready,
    quality,
    sharpness,
    brightness: exposure.brightness,
    contrast: exposure.contrast,
    paperPresence: paper.score,
    paperRatio: paper.paperRatio,
    paperInkRatio: paper.paperInkRatio,
    componentInkRatio: paper.componentInkRatio,
    componentStrongInkRatio: paper.componentStrongInkRatio,
    signature,
    sourceWidth,
    sourceHeight,
    analysisWidth: canvas.width,
    analysisHeight: canvas.height,
    points: regionToPoints(paper.region, sourceWidth, sourceHeight),
    areaRatio: 1,
    message: ready ? "Sharp page candidate" : paper.present ? "Waiting for a sharper page" : "Waiting for paper in view",
    signatureSource: "center-content-motion"
  };
}

function makeLumaFrame(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);

  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    gray[target] = data[source] * 0.299 + data[source + 1] * 0.587 + data[source + 2] * 0.114;
  }

  return { gray, width, height };
}

function measureExposure(gray) {
  let total = 0;
  for (let index = 0; index < gray.length; index += 1) {
    total += gray[index];
  }

  const brightness = total / gray.length;
  let variance = 0;

  for (let index = 0; index < gray.length; index += 1) {
    const delta = gray[index] - brightness;
    variance += delta * delta;
  }

  return {
    brightness,
    contrast: Math.sqrt(variance / gray.length)
  };
}

function measureSharpness(gray, width, height) {
  const x0 = Math.floor(width * 0.08);
  const x1 = Math.ceil(width * 0.92);
  const y0 = Math.floor(height * 0.08);
  const y1 = Math.ceil(height * 0.92);
  let total = 0;
  let count = 0;

  for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
    for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
      const center = gray[y * width + x] * 4;
      const laplacian = Math.abs(
        center -
        gray[y * width + x - 1] -
        gray[y * width + x + 1] -
        gray[(y - 1) * width + x] -
        gray[(y + 1) * width + x]
      );

      total += laplacian;
      count += 1;
    }
  }

  return count ? total / count : 0;
}

function measurePaperPresence(imageData, gray, width, height) {
  const { data } = imageData;
  const x0 = Math.floor(width * 0.06);
  const x1 = Math.ceil(width * 0.94);
  const y0 = Math.floor(height * 0.08);
  const y1 = Math.ceil(height * 0.96);
  const mask = new Uint8Array(width * height);
  let samples = 0;
  let paperPixels = 0;
  let paperInk = 0;
  let strongInk = 0;
  let weightedArea = 0;

  for (let y = Math.max(2, y0); y < Math.min(height - 2, y1); y += 1) {
    const verticalWeight = y > height * 0.22 ? 1 : 0.54;

    for (let x = Math.max(2, x0); x < Math.min(width - 2, x1); x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const light = gray[y * width + x];
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const chroma = maxChannel - minChannel;
      const paperLike = (light > 154 && chroma < 52) || (light > 186 && chroma < 76);

      samples += 1;
      if (!paperLike) {
        continue;
      }

      const ink = inkAt(gray, width, x, y);
      mask[y * width + x] = 1;
      paperPixels += 1;
      weightedArea += verticalWeight;
      paperInk += ink;
      if (ink > 0.08) {
        strongInk += 1;
      }
    }
  }

  const paperRatio = paperPixels / Math.max(1, samples);
  const weightedPaperRatio = weightedArea / Math.max(1, samples);
  const paperInkRatio = paperInk / Math.max(1, paperPixels);
  const strongInkRatio = strongInk / Math.max(1, paperPixels);
  const component = findBestPaperComponent(mask, gray, width, height, x0, x1, y0, y1);
  const componentRatio = component.count / Math.max(1, samples);
  const areaScore = clamp01((weightedPaperRatio - 0.14) / 0.36);
  const componentScore = clamp01((componentRatio - 0.07) / 0.28);
  const inkScore = clamp01((paperInkRatio - 0.018) / 0.05);
  const strongInkScore = clamp01((strongInkRatio - 0.035) / 0.12);
  const componentInkScore = clamp01((component.componentInkRatio - 0.04) / 0.1);
  const score = clamp01(
    areaScore * 0.18 +
    componentScore * 0.22 +
    inkScore * 0.18 +
    strongInkScore * 0.12 +
    componentInkScore * 0.3
  );

  return {
    score,
    paperRatio,
    paperInkRatio,
    componentInkRatio: component.componentInkRatio,
    componentStrongInkRatio: component.componentStrongInkRatio,
    componentRatio,
    region: component.region,
    present: score >= 0.2 &&
      paperRatio >= 0.16 &&
      componentRatio >= 0.08 &&
      (
        component.componentInkRatio >= 0.045 ||
        component.componentStrongInkRatio >= 0.08 ||
        paperInkRatio >= 0.055
      )
  };
}

function findBestPaperComponent(mask, gray, width, height, x0, x1, y0, y1) {
  const visited = new Uint8Array(mask.length);
  const stack = [];
  let best = null;

  for (let y = Math.max(2, y0); y < Math.min(height - 2, y1); y += 1) {
    for (let x = Math.max(2, x0); x < Math.min(width - 2, x1); x += 1) {
      const start = y * width + x;
      if (!mask[start] || visited[start]) {
        continue;
      }

      let count = 0;
      let ink = 0;
      let strongInk = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;
      stack.push(start);
      visited[start] = 1;

      while (stack.length) {
        const index = stack.pop();
        const pointY = Math.floor(index / width);
        const pointX = index - pointY * width;

        count += 1;
        sumX += pointX;
        sumY += pointY;
        minX = Math.min(minX, pointX);
        maxX = Math.max(maxX, pointX);
        minY = Math.min(minY, pointY);
        maxY = Math.max(maxY, pointY);
        const pointInk = inkAt(gray, width, pointX, pointY);
        ink += pointInk;
        if (pointInk > 0.08) {
          strongInk += 1;
        }

        const neighbors = [index - 1, index + 1, index - width, index + width];
        for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex += 1) {
          const neighbor = neighbors[neighborIndex];
          if (neighbor < 0 || neighbor >= mask.length || visited[neighbor] || !mask[neighbor]) {
            continue;
          }

          const neighborY = Math.floor(neighbor / width);
          const neighborX = neighbor - neighborY * width;
          if (neighborX < x0 || neighborX >= x1 || neighborY < y0 || neighborY >= y1) {
            continue;
          }

          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }

      const centerX = sumX / Math.max(1, count) / width;
      const centerY = sumY / Math.max(1, count) / height;
      const centerWeight = clamp01(1 - Math.abs(centerX - 0.5) * 0.62 - Math.max(0, 0.2 - centerY) * 0.8);
      const componentInkRatio = ink / Math.max(1, count);
      const componentStrongInkRatio = strongInk / Math.max(1, count);
      const inkWeight = clamp01((componentInkRatio - 0.035) / 0.09);
      const strongInkWeight = clamp01((componentStrongInkRatio - 0.04) / 0.15);
      const pageLikelihood = inkWeight * 0.68 + strongInkWeight * 0.22 + centerWeight * 0.1;
      const score = count * pageLikelihood;

      if (!best || score > best.score) {
        best = {
          count,
          score,
          minX,
          maxX,
          minY,
          maxY,
          componentInkRatio,
          componentStrongInkRatio
        };
      }
    }
  }

  if (!best) {
    return {
      count: 0,
      componentInkRatio: 0,
      componentStrongInkRatio: 0,
      region: {
        x0: 0.12,
        y0: 0.08,
        x1: 0.88,
        y1: 0.92,
        confidence: 0
      }
    };
  }

  const padX = Math.max(3, Math.round(width * 0.045));
  const padY = Math.max(3, Math.round(height * 0.055));
  const region = enforceMinRegion({
    x0: (best.minX - padX) / width,
    y0: (best.minY - padY) / height,
    x1: (best.maxX + padX) / width,
    y1: (best.maxY + padY) / height,
    confidence: clamp01(best.count / (width * height * 0.42))
  }, 0.3, 0.34);

  return {
    count: best.count,
    componentInkRatio: best.componentInkRatio,
    componentStrongInkRatio: best.componentStrongInkRatio,
    region
  };
}

function createChangeSignature(gray, width, height, paperRegion = null, imageData = null) {
  const region = detectContentRegion(gray, width, height, paperRegion);
  const detailRegion = expandRegion(region, 0.07, width, height);
  const broadRegion = expandRegion(region, 0.12, width, height);
  const luma = blockSignature(gray, width, height, {
    ...broadRegion,
    columns: 14,
    rows: 18,
    mode: "luma"
  });
  const texture = blockSignature(gray, width, height, {
    ...detailRegion,
    columns: 14,
    rows: 18,
    mode: "texture"
  });
  const ink = blockSignature(gray, width, height, {
    ...detailRegion,
    columns: 16,
    rows: 20,
    mode: "ink"
  });
  const rows = profileSignature(gray, width, height, {
    ...detailRegion,
    buckets: 26,
    axis: "y"
  });
  const columns = profileSignature(gray, width, height, {
    ...detailRegion,
    buckets: 20,
    axis: "x"
  });
  const pyramid = createConvolutionPyramid(gray, width, height, detailRegion);
  const landmarks = createLandmarks(gray, width, height, detailRegion);
  const patch = createContentPatch(gray, width, height, detailRegion);
  const warm = colorBlockSignature(imageData, width, height, {
    ...broadRegion,
    columns: 12,
    rows: 16,
    mode: "warm"
  });
  const saturation = colorBlockSignature(imageData, width, height, {
    ...broadRegion,
    columns: 12,
    rows: 16,
    mode: "saturation"
  });
  const lowHash = perceptualHash(gray, width, height, {
    ...broadRegion,
    mode: "luma"
  });
  const inkHash = perceptualHash(gray, width, height, {
    ...detailRegion,
    mode: "ink"
  });
  const hashValues = [
    ...luma.values,
    ...texture.values,
    ...ink.values,
    ...rows.values,
    ...columns.values,
    ...pyramid.flatMap((layer) => layer.values)
  ];
  const mean = hashValues.reduce((sum, value) => sum + value, 0) / hashValues.length;
  let hash = "";

  for (let index = 0; index < hashValues.length; index += 1) {
    hash += hashValues[index] > mean ? "1" : "0";
  }

  return {
    luma,
    texture,
    ink,
    rows,
    columns,
    pyramid,
    landmarks,
    patch,
    warm,
    saturation,
    hash,
    lowHash,
    inkHash,
    region
  };
}

function detectContentRegion(gray, width, height, limitRegion = null) {
  const bounds = limitRegion || {
    x0: 0,
    y0: 0,
    x1: 1,
    y1: 1,
    confidence: 0
  };
  const columns = 28;
  const rows = 36;
  const energies = [];

  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.max(1, Math.floor((bounds.y0 + row / rows * (bounds.y1 - bounds.y0)) * height));
    const y1 = Math.min(height - 1, Math.ceil((bounds.y0 + (row + 1) / rows * (bounds.y1 - bounds.y0)) * height));

    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.max(1, Math.floor((bounds.x0 + column / columns * (bounds.x1 - bounds.x0)) * width));
      const x1 = Math.min(width - 1, Math.ceil((bounds.x0 + (column + 1) / columns * (bounds.x1 - bounds.x0)) * width));
      let total = 0;
      let count = 0;

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          total += inkAt(gray, width, x, y) * 0.78 + textureAt(gray, width, x, y) * 0.22;
          count += 1;
        }
      }

      energies.push({
        x: bounds.x0 + (column + 0.5) / columns * (bounds.x1 - bounds.x0),
        y: bounds.y0 + (row + 0.5) / rows * (bounds.y1 - bounds.y0),
        value: total / Math.max(1, count)
      });
    }
  }

  const sorted = energies.map((item) => item.value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const high = sorted[Math.floor(sorted.length * 0.88)] || 0;
  const threshold = Math.max(0.018, median + (high - median) * 0.42);
  const active = energies
    .map((item) => ({ ...item, weight: Math.max(0, item.value - threshold) }))
    .filter((item) => item.weight > 0);
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);

  if (active.length < 10 || totalWeight < 0.08) {
    return enforceMinRegion(bounds.confidence ? bounds : {
      x0: 0.12,
      y0: 0.08,
      x1: 0.88,
      y1: 0.92,
      confidence: 0
    }, 0.32, 0.34);
  }

  const x0 = weightedQuantile(active, "x", 0.04);
  const x1 = weightedQuantile(active, "x", 0.96);
  const y0 = weightedQuantile(active, "y", 0.04);
  const y1 = weightedQuantile(active, "y", 0.96);
  const minWidth = 0.28;
  const minHeight = 0.3;
  const region = enforceMinRegion({
    x0,
    y0,
    x1,
    y1,
    confidence: clamp01(totalWeight / 1.2)
  }, minWidth, minHeight);

  const expanded = expandRegion(region, 0.08, width, height);
  return limitRegion ? clampRegionToBounds(expanded, expandRegion(limitRegion, 0.03, width, height)) : expanded;
}

function weightedQuantile(items, key, quantile) {
  const sorted = [...items].sort((a, b) => a[key] - b[key]);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = total * quantile;
  let cumulative = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    cumulative += sorted[index].weight;
    if (cumulative >= target) {
      return sorted[index][key];
    }
  }

  return sorted[sorted.length - 1]?.[key] ?? 0.5;
}

function enforceMinRegion(region, minWidth, minHeight) {
  let { x0, y0, x1, y1 } = region;
  const width = x1 - x0;
  const height = y1 - y0;

  if (width < minWidth) {
    const center = (x0 + x1) / 2;
    x0 = center - minWidth / 2;
    x1 = center + minWidth / 2;
  }

  if (height < minHeight) {
    const center = (y0 + y1) / 2;
    y0 = center - minHeight / 2;
    y1 = center + minHeight / 2;
  }

  return {
    ...region,
    x0: clamp(x0, 0.02, 0.96),
    y0: clamp(y0, 0.02, 0.96),
    x1: clamp(x1, 0.04, 0.98),
    y1: clamp(y1, 0.04, 0.98)
  };
}

function expandRegion(region, amount, width, height) {
  const aspect = width / Math.max(1, height);
  const xPad = amount;
  const yPad = amount * aspect;
  const expanded = enforceMinRegion({
    ...region,
    x0: region.x0 - xPad,
    y0: region.y0 - yPad,
    x1: region.x1 + xPad,
    y1: region.y1 + yPad
  }, 0.32, 0.34);

  return {
    ...expanded,
    x0: Math.max(0.01, expanded.x0),
    y0: Math.max(0.01, expanded.y0),
    x1: Math.min(0.99, expanded.x1),
    y1: Math.min(0.99, expanded.y1)
  };
}

function clampRegionToBounds(region, bounds) {
  const clamped = {
    ...region,
    x0: Math.max(bounds.x0, region.x0),
    y0: Math.max(bounds.y0, region.y0),
    x1: Math.min(bounds.x1, region.x1),
    y1: Math.min(bounds.y1, region.y1)
  };

  if (clamped.x1 - clamped.x0 < 0.18 || clamped.y1 - clamped.y0 < 0.22) {
    return region;
  }

  return clamped;
}

function regionToPoints(region, sourceWidth, sourceHeight) {
  if (!region?.confidence) {
    return null;
  }

  return [
    { x: region.x0 * sourceWidth, y: region.y0 * sourceHeight },
    { x: region.x1 * sourceWidth, y: region.y0 * sourceHeight },
    { x: region.x1 * sourceWidth, y: region.y1 * sourceHeight },
    { x: region.x0 * sourceWidth, y: region.y1 * sourceHeight }
  ];
}

function blockSignature(gray, width, height, options) {
  const xStart = Math.floor(width * options.x0);
  const xEnd = Math.ceil(width * options.x1);
  const yStart = Math.floor(height * options.y0);
  const yEnd = Math.ceil(height * options.y1);
  const blockTotals = Array.from({ length: options.columns * options.rows }, () => 0);
  const blockCounts = Array.from({ length: options.columns * options.rows }, () => 0);
  const spanX = Math.max(1, xEnd - xStart);
  const spanY = Math.max(1, yEnd - yStart);

  let globalCount = 0;

  for (let y = Math.max(1, yStart); y < Math.min(height - 1, yEnd); y += 1) {
    for (let x = Math.max(1, xStart); x < Math.min(width - 1, xEnd); x += 1) {
      const col = Math.min(options.columns - 1, Math.floor((x - xStart) / spanX * options.columns));
      const row = Math.min(options.rows - 1, Math.floor((y - yStart) / spanY * options.rows));
      const index = row * options.columns + col;
      const value = sampleAt(gray, width, x, y, options.mode);

      blockTotals[index] += value;
      blockCounts[index] += 1;
      globalCount += 1;
    }
  }

  const rawValues = blockTotals.map((value, index) => value / Math.max(1, blockCounts[index]));
  const values = normalizeValues(rawValues, options.mode === "luma" ? 2.7 : 2.25);
  const weight = Math.min(1, Math.max(0.35, globalCount / Math.max(1, spanX * spanY)));

  return {
    columns: options.columns,
    rows: options.rows,
    values,
    weight
  };
}

function colorBlockSignature(imageData, width, height, options) {
  if (!imageData?.data) {
    return {
      columns: options.columns,
      rows: options.rows,
      values: Array.from({ length: options.columns * options.rows }, () => 0.5),
      weight: 0.2
    };
  }

  const { data } = imageData;
  const xStart = Math.floor(width * options.x0);
  const xEnd = Math.ceil(width * options.x1);
  const yStart = Math.floor(height * options.y0);
  const yEnd = Math.ceil(height * options.y1);
  const totals = Array.from({ length: options.columns * options.rows }, () => 0);
  const counts = Array.from({ length: options.columns * options.rows }, () => 0);
  const spanX = Math.max(1, xEnd - xStart);
  const spanY = Math.max(1, yEnd - yStart);

  for (let y = Math.max(1, yStart); y < Math.min(height - 1, yEnd); y += 1) {
    for (let x = Math.max(1, xStart); x < Math.min(width - 1, xEnd); x += 1) {
      const column = Math.min(options.columns - 1, Math.floor((x - xStart) / spanX * options.columns));
      const row = Math.min(options.rows - 1, Math.floor((y - yStart) / spanY * options.rows));
      const index = row * options.columns + column;
      const dataIndex = (y * width + x) * 4;
      const red = data[dataIndex] / 255;
      const green = data[dataIndex + 1] / 255;
      const blue = data[dataIndex + 2] / 255;
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const saturation = maxChannel - minChannel;
      const warm = (red - blue + 1) / 2;
      const greenMagenta = (green - (red + blue) * 0.5 + 1) / 2;
      const value = options.mode === "saturation"
        ? saturation
        : warm * 0.72 + greenMagenta * 0.28;

      totals[index] += value;
      counts[index] += 1;
    }
  }

  return {
    columns: options.columns,
    rows: options.rows,
    values: normalizeValues(totals.map((value, index) => value / Math.max(1, counts[index])), 2.4),
    weight: 1
  };
}

function createConvolutionPyramid(gray, width, height, region) {
  return [
    convolutionLayer(gray, width, height, region, {
      columns: 18,
      rows: 24,
      mode: "ink",
      weight: 0.34
    }),
    convolutionLayer(gray, width, height, region, {
      columns: 14,
      rows: 18,
      mode: "texture",
      weight: 0.22
    }),
    convolutionLayer(gray, width, height, region, {
      columns: 12,
      rows: 16,
      mode: "blob",
      weight: 0.18
    }),
    convolutionLayer(gray, width, height, region, {
      columns: 10,
      rows: 14,
      mode: "horizontal",
      weight: 0.13
    }),
    convolutionLayer(gray, width, height, region, {
      columns: 10,
      rows: 14,
      mode: "vertical",
      weight: 0.13
    })
  ];
}

function createLandmarks(gray, width, height, region) {
  const columns = 36;
  const rows = 46;
  const values = new Float32Array(columns * rows);
  const xStart = width * region.x0;
  const xEnd = width * region.x1;
  const yStart = height * region.y0;
  const yEnd = height * region.y1;

  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(height - 2, Math.max(2, Math.round(yStart + (row + 0.5) / rows * (yEnd - yStart))));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(width - 2, Math.max(2, Math.round(xStart + (column + 0.5) / columns * (xEnd - xStart))));
      values[row * columns + column] = inkAt(gray, width, x, y) * 0.7 + blobAt(gray, width, x, y) * 0.3;
    }
  }

  const normalized = normalizeValues([...values], 2.2);
  const candidates = [];

  for (let row = 2; row < rows - 2; row += 1) {
    for (let column = 2; column < columns - 2; column += 1) {
      const value = normalized[row * columns + column];
      if (value < 0.58 || !isLocalMaximum(normalized, columns, rows, column, row)) {
        continue;
      }

      candidates.push({
        column,
        row,
        strength: value,
        descriptor: describeLandmark(normalized, columns, rows, column, row)
      });
    }
  }

  return candidates
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 54)
    .map((candidate) => ({
      x: candidate.column / (columns - 1),
      y: candidate.row / (rows - 1),
      strength: candidate.strength,
      descriptor: candidate.descriptor
    }));
}

function createContentPatch(gray, width, height, region) {
  const columns = 34;
  const rows = 44;
  const values = new Float32Array(columns * rows);
  const xStart = width * region.x0;
  const xEnd = width * region.x1;
  const yStart = height * region.y0;
  const yEnd = height * region.y1;

  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(height - 2, Math.max(2, Math.round(yStart + (row + 0.5) / rows * (yEnd - yStart))));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(width - 2, Math.max(2, Math.round(xStart + (column + 0.5) / columns * (xEnd - xStart))));
      const luma = 1 - gray[y * width + x] / 255;
      values[row * columns + column] = inkAt(gray, width, x, y) * 0.62 + blobAt(gray, width, x, y) * 0.22 + luma * 0.16;
    }
  }

  return {
    columns,
    rows,
    values: normalizeSigned(values)
  };
}

function normalizeSigned(values) {
  let mean = 0;
  for (let index = 0; index < values.length; index += 1) {
    mean += values[index];
  }
  mean /= Math.max(1, values.length);

  let variance = 0;
  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - mean;
    variance += delta * delta;
  }

  const deviation = Math.sqrt(variance / Math.max(1, values.length)) || 1;
  const normalized = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = (values[index] - mean) / deviation;
  }

  return normalized;
}

function isLocalMaximum(values, columns, rows, column, row) {
  const center = values[row * columns + column];

  for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y += 1) {
    for (let x = Math.max(0, column - 1); x <= Math.min(columns - 1, column + 1); x += 1) {
      if ((x !== column || y !== row) && values[y * columns + x] > center) {
        return false;
      }
    }
  }

  return true;
}

function describeLandmark(values, columns, rows, column, row) {
  const pairs = [
    [-3, -2, 3, 2], [-2, -3, 2, 3], [-4, 0, 4, 0], [0, -4, 0, 4],
    [-3, 2, 2, -3], [3, -1, -2, 2], [-1, -3, 3, 1], [-4, 2, 1, -2],
    [-2, 0, 2, 0], [0, -2, 0, 2], [-2, -1, 2, 1], [-1, 2, 1, -2],
    [-5, -1, 2, 3], [4, 1, -3, -2], [-1, 4, 2, -3], [3, -4, -2, 1],
    [-3, -3, -1, 3], [1, -3, 3, 3], [-4, -2, 4, -1], [-4, 1, 4, 2],
    [-2, -4, -1, 4], [1, -4, 2, 4], [-5, 0, 0, 5], [0, -5, 5, 0],
    [-3, 1, 4, 3], [3, -3, -4, -1], [-2, 3, 4, -2], [2, -4, -3, 2],
    [-1, -1, 1, 1], [-1, 1, 1, -1], [-3, 0, 0, 3], [0, -3, 3, 0]
  ];
  let descriptor = 0;

  for (let index = 0; index < pairs.length; index += 1) {
    const [ax, ay, bx, by] = pairs[index];
    const first = sampleGrid(values, columns, rows, column + ax, row + ay);
    const second = sampleGrid(values, columns, rows, column + bx, row + by);
    if (first > second) {
      descriptor |= 1 << index;
    }
  }

  return descriptor >>> 0;
}

function sampleGrid(values, columns, rows, x, y) {
  const column = Math.max(0, Math.min(columns - 1, Math.round(x)));
  const row = Math.max(0, Math.min(rows - 1, Math.round(y)));
  return values[row * columns + column];
}

function convolutionLayer(gray, width, height, region, options) {
  const xStart = Math.floor(width * region.x0);
  const xEnd = Math.ceil(width * region.x1);
  const yStart = Math.floor(height * region.y0);
  const yEnd = Math.ceil(height * region.y1);
  const totals = Array.from({ length: options.columns * options.rows }, () => 0);
  const counts = Array.from({ length: options.columns * options.rows }, () => 0);
  const spanX = Math.max(1, xEnd - xStart);
  const spanY = Math.max(1, yEnd - yStart);

  for (let y = Math.max(2, yStart); y < Math.min(height - 2, yEnd); y += 1) {
    for (let x = Math.max(2, xStart); x < Math.min(width - 2, xEnd); x += 1) {
      const column = Math.min(options.columns - 1, Math.floor((x - xStart) / spanX * options.columns));
      const row = Math.min(options.rows - 1, Math.floor((y - yStart) / spanY * options.rows));
      const index = row * options.columns + column;

      totals[index] += sampleAt(gray, width, x, y, options.mode);
      counts[index] += 1;
    }
  }

  return {
    columns: options.columns,
    rows: options.rows,
    weight: options.weight,
    values: normalizeValues(totals.map((value, index) => value / Math.max(1, counts[index])), 2.15)
  };
}

function profileSignature(gray, width, height, options) {
  const xStart = Math.floor(width * options.x0);
  const xEnd = Math.ceil(width * options.x1);
  const yStart = Math.floor(height * options.y0);
  const yEnd = Math.ceil(height * options.y1);
  const totals = Array.from({ length: options.buckets }, () => 0);
  const counts = Array.from({ length: options.buckets }, () => 0);
  const spanX = Math.max(1, xEnd - xStart);
  const spanY = Math.max(1, yEnd - yStart);

  for (let y = Math.max(1, yStart); y < Math.min(height - 1, yEnd); y += 1) {
    for (let x = Math.max(1, xStart); x < Math.min(width - 1, xEnd); x += 1) {
      const bucket = options.axis === "x"
        ? Math.min(options.buckets - 1, Math.floor((x - xStart) / spanX * options.buckets))
        : Math.min(options.buckets - 1, Math.floor((y - yStart) / spanY * options.buckets));
      totals[bucket] += inkAt(gray, width, x, y);
      counts[bucket] += 1;
    }
  }

  return {
    values: normalizeValues(totals.map((value, index) => value / Math.max(1, counts[index])), 3)
  };
}

function sampleAt(gray, width, x, y, mode) {
  if (mode === "texture") {
    return textureAt(gray, width, x, y);
  }

  if (mode === "ink") {
    return inkAt(gray, width, x, y);
  }

  if (mode === "blob") {
    return blobAt(gray, width, x, y);
  }

  if (mode === "horizontal") {
    return horizontalStrokeAt(gray, width, x, y);
  }

  if (mode === "vertical") {
    return verticalStrokeAt(gray, width, x, y);
  }

  return gray[y * width + x];
}

function textureAt(gray, width, x, y) {
  const index = y * width + x;
  const horizontal = Math.abs(gray[index] - gray[index - 1]);
  const vertical = Math.abs(gray[index] - gray[index - width]);
  return Math.log1p(horizontal + vertical) / Math.log1p(510);
}

function inkAt(gray, width, x, y) {
  const index = y * width + x;
  const gradient = Math.abs(gray[index] - gray[index - 1]) +
    Math.abs(gray[index] - gray[index - width]) +
    Math.abs(gray[index] - gray[index + 1]) +
    Math.abs(gray[index] - gray[index + width]);
  const center = gray[index];
  const neighborhood = (
    gray[index - 1] +
    gray[index + 1] +
    gray[index - width] +
    gray[index + width]
  ) / 4;
  const localContrast = Math.abs(center - neighborhood);
  return clamp01((gradient * 0.72 + localContrast * 1.35 - 14) / 120);
}

function blobAt(gray, width, x, y) {
  const index = y * width + x;
  const near = (
    gray[index - 1] +
    gray[index + 1] +
    gray[index - width] +
    gray[index + width]
  ) / 4;
  const far = (
    gray[index - 2] +
    gray[index + 2] +
    gray[index - width * 2] +
    gray[index + width * 2]
  ) / 4;

  return clamp01(Math.abs(gray[index] * 0.55 + near * 0.45 - far) / 80);
}

function horizontalStrokeAt(gray, width, x, y) {
  const index = y * width + x;
  const verticalContrast = Math.abs(gray[index] * 2 - gray[index - width] - gray[index + width]);
  const horizontalContinuity = 255 - Math.abs(gray[index - 1] - gray[index + 1]);

  return clamp01((verticalContrast * 0.74 + horizontalContinuity * 0.08 - 18) / 110);
}

function verticalStrokeAt(gray, width, x, y) {
  const index = y * width + x;
  const horizontalContrast = Math.abs(gray[index] * 2 - gray[index - 1] - gray[index + 1]);
  const verticalContinuity = 255 - Math.abs(gray[index - width] - gray[index + width]);

  return clamp01((horizontalContrast * 0.74 + verticalContinuity * 0.08 - 18) / 110);
}

function perceptualHash(gray, width, height, options) {
  const size = 32;
  const coefficients = 8;
  const samples = new Float32Array(size * size);
  const xStart = width * options.x0;
  const xEnd = width * options.x1;
  const yStart = height * options.y0;
  const yEnd = height * options.y1;

  for (let row = 0; row < size; row += 1) {
    const y = Math.min(height - 2, Math.max(1, Math.round(yStart + (row + 0.5) / size * (yEnd - yStart))));
    for (let column = 0; column < size; column += 1) {
      const x = Math.min(width - 2, Math.max(1, Math.round(xStart + (column + 0.5) / size * (xEnd - xStart))));
      samples[row * size + column] = sampleAt(gray, width, x, y, options.mode);
    }
  }

  const values = [];

  for (let v = 0; v < coefficients; v += 1) {
    for (let u = 0; u < coefficients; u += 1) {
      if (u === 0 && v === 0) {
        continue;
      }

      let total = 0;
      for (let y = 0; y < size; y += 1) {
        const cosY = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
        for (let x = 0; x < size; x += 1) {
          const cosX = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
          total += samples[y * size + x] * cosX * cosY;
        }
      }
      values.push(total);
    }
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  let hash = "";

  for (let index = 0; index < values.length; index += 1) {
    hash += values[index] > median ? "1" : "0";
  }

  return hash;
}

function normalizeValues(values, spread = 3) {
  if (!values.length) {
    return [];
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let variance = 0;

  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - mean;
    variance += delta * delta;
  }

  const deviation = Math.sqrt(variance / values.length) || 1;
  return values.map((value) => clamp01(0.5 + (value - mean) / (deviation * spread)));
}

function shiftedGridDistance(a, b) {
  if (!a || !b || a.columns !== b.columns || a.rows !== b.rows || a.values.length !== b.values.length) {
    return 1;
  }

  let best = Infinity;

  for (let shiftY = -2; shiftY <= 2; shiftY += 1) {
    for (let shiftX = -2; shiftX <= 2; shiftX += 1) {
      let total = 0;
      let count = 0;

      for (let row = 0; row < a.rows; row += 1) {
        const otherRow = row + shiftY;
        if (otherRow < 0 || otherRow >= a.rows) {
          continue;
        }

        for (let column = 0; column < a.columns; column += 1) {
          const otherColumn = column + shiftX;
          if (otherColumn < 0 || otherColumn >= a.columns) {
            continue;
          }

          total += Math.abs(
            a.values[row * a.columns + column] -
            b.values[otherRow * b.columns + otherColumn]
          );
          count += 1;
        }
      }

      if (count) {
        best = Math.min(best, total / count);
      }
    }
  }

  return Number.isFinite(best) ? best : 1;
}

function pyramidDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 1;
  }

  let total = 0;
  let weight = 0;

  for (let index = 0; index < a.length; index += 1) {
    const layerWeight = a[index].weight || 1;
    total += transformedGridDistance(a[index], b[index]) * layerWeight;
    weight += layerWeight;
  }

  return weight ? total / weight : 1;
}

function landmarkDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 6 || b.length < 6) {
    return 1;
  }

  const source = a.length <= b.length ? a : b;
  const target = a.length <= b.length ? b : a;
  const usable = source.slice(0, Math.min(36, source.length));
  let matched = 0;
  let quality = 0;

  for (let index = 0; index < usable.length; index += 1) {
    const point = usable[index];
    let best = Infinity;

    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      const candidate = target[targetIndex];
      const descriptorDistance = bitCount32(point.descriptor ^ candidate.descriptor) / 32;
      const locationDistance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      const score = descriptorDistance * 0.86 + Math.min(1, locationDistance / 0.38) * 0.14;
      best = Math.min(best, score);
    }

    if (best < 0.34) {
      matched += 1;
      quality += 1 - best / 0.34;
    }
  }

  const matchRatio = matched / usable.length;
  const qualityRatio = quality / usable.length;
  return clamp01(1 - (matchRatio * 0.72 + qualityRatio * 0.28));
}

function patchDistance(a, b) {
  if (!a || !b || a.columns !== b.columns || a.rows !== b.rows || a.values.length !== b.values.length) {
    return 1;
  }

  const scales = [0.62, 0.72, 0.84, 0.94, 1, 1.08, 1.2, 1.36, 1.52];
  const shifts = [-8, -5, -3, 0, 3, 5, 8];
  const centerX = (a.columns - 1) / 2;
  const centerY = (a.rows - 1) / 2;
  let best = -1;

  for (let scaleIndex = 0; scaleIndex < scales.length; scaleIndex += 1) {
    const scale = scales[scaleIndex];

    for (let yShiftIndex = 0; yShiftIndex < shifts.length; yShiftIndex += 1) {
      const shiftY = shifts[yShiftIndex];

      for (let xShiftIndex = 0; xShiftIndex < shifts.length; xShiftIndex += 1) {
        const shiftX = shifts[xShiftIndex];
        let dot = 0;
        let firstPower = 0;
        let secondPower = 0;
        let count = 0;

        for (let row = 0; row < a.rows; row += 1) {
          const sourceY = (row - centerY) / scale + centerY + shiftY;
          if (sourceY < 0 || sourceY > b.rows - 1) {
            continue;
          }

          for (let column = 0; column < a.columns; column += 1) {
            const sourceX = (column - centerX) / scale + centerX + shiftX;
            if (sourceX < 0 || sourceX > b.columns - 1) {
              continue;
            }

            const first = a.values[row * a.columns + column];
            const second = bilinearPatchValue(b, sourceX, sourceY);
            dot += first * second;
            firstPower += first * first;
            secondPower += second * second;
            count += 1;
          }
        }

        if (count >= a.values.length * 0.42 && firstPower > 0 && secondPower > 0) {
          const correlation = dot / Math.sqrt(firstPower * secondPower);
          const overlapPenalty = (1 - count / a.values.length) * 0.08;
          best = Math.max(best, correlation - overlapPenalty);
        }
      }
    }
  }

  return best <= -1 ? 1 : clamp01((1 - best) / 2);
}

function regionMotionDistance(a, b) {
  if (!a || !b) {
    return 0;
  }

  const centerAx = (a.x0 + a.x1) / 2;
  const centerAy = (a.y0 + a.y1) / 2;
  const centerBx = (b.x0 + b.x1) / 2;
  const centerBy = (b.y0 + b.y1) / 2;
  const areaA = Math.max(0.001, (a.x1 - a.x0) * (a.y1 - a.y0));
  const areaB = Math.max(0.001, (b.x1 - b.x0) * (b.y1 - b.y0));
  const centerDistance = Math.hypot(centerAx - centerBx, centerAy - centerBy);
  const scaleDistance = Math.abs(Math.log(areaA / areaB));

  return centerDistance * 0.8 + scaleDistance * 0.28;
}

function bilinearPatchValue(patch, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(patch.columns - 1, x0 + 1);
  const y1 = Math.min(patch.rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = patch.values[y0 * patch.columns + x0];
  const topRight = patch.values[y0 * patch.columns + x1];
  const bottomLeft = patch.values[y1 * patch.columns + x0];
  const bottomRight = patch.values[y1 * patch.columns + x1];
  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;

  return top * (1 - ty) + bottom * ty;
}

function bitCount32(value) {
  let count = 0;
  let current = value >>> 0;

  while (current) {
    current &= current - 1;
    count += 1;
  }

  return count;
}

function transformedGridDistance(a, b) {
  if (!a || !b || a.columns !== b.columns || a.rows !== b.rows || a.values.length !== b.values.length) {
    return 1;
  }

  const scaleCandidates = [0.82, 0.9, 0.96, 1, 1.05, 1.12, 1.22];
  const shiftCandidates = [-2, -1, 0, 1, 2];
  const centerX = (a.columns - 1) / 2;
  const centerY = (a.rows - 1) / 2;
  let best = Infinity;

  for (let scaleIndex = 0; scaleIndex < scaleCandidates.length; scaleIndex += 1) {
    const scale = scaleCandidates[scaleIndex];

    for (let yShiftIndex = 0; yShiftIndex < shiftCandidates.length; yShiftIndex += 1) {
      const shiftY = shiftCandidates[yShiftIndex];

      for (let xShiftIndex = 0; xShiftIndex < shiftCandidates.length; xShiftIndex += 1) {
        const shiftX = shiftCandidates[xShiftIndex];
        let total = 0;
        let count = 0;

        for (let row = 0; row < a.rows; row += 1) {
          const sourceY = (row - centerY) / scale + centerY + shiftY;
          if (sourceY < 0 || sourceY > b.rows - 1) {
            continue;
          }

          for (let column = 0; column < a.columns; column += 1) {
            const sourceX = (column - centerX) / scale + centerX + shiftX;
            if (sourceX < 0 || sourceX > b.columns - 1) {
              continue;
            }

            total += Math.abs(a.values[row * a.columns + column] - bilinearGridValue(b, sourceX, sourceY));
            count += 1;
          }
        }

        if (count >= a.values.length * 0.58) {
          const missingPenalty = (1 - count / a.values.length) * 0.05;
          best = Math.min(best, total / count + missingPenalty);
        }
      }
    }
  }

  return Number.isFinite(best) ? best : 1;
}

function bilinearGridValue(grid, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.columns - 1, x0 + 1);
  const y1 = Math.min(grid.rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = grid.values[y0 * grid.columns + x0];
  const topRight = grid.values[y0 * grid.columns + x1];
  const bottomLeft = grid.values[y1 * grid.columns + x0];
  const bottomRight = grid.values[y1 * grid.columns + x1];
  const top = topLeft * (1 - tx) + topRight * tx;
  const bottom = bottomLeft * (1 - tx) + bottomRight * tx;

  return top * (1 - ty) + bottom * ty;
}

function shiftedSeriesDistance(a, b, maxShift) {
  if (!a?.values || !b?.values || a.values.length !== b.values.length) {
    return 1;
  }

  let best = Infinity;

  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    let total = 0;
    let count = 0;

    for (let index = 0; index < a.values.length; index += 1) {
      const otherIndex = index + shift;
      if (otherIndex < 0 || otherIndex >= b.values.length) {
        continue;
      }

      total += Math.abs(a.values[index] - b.values[otherIndex]);
      count += 1;
    }

    if (count) {
      best = Math.min(best, total / count);
    }
  }

  return Number.isFinite(best) ? best : 1;
}

function hammingRatio(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 1;
  }

  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      distance += 1;
    }
  }

  return distance / a.length;
}

function emptyResult(message, sourceWidth = 0, sourceHeight = 0) {
  return {
    found: false,
    ready: false,
    quality: 0,
    sharpness: 0,
    brightness: 0,
    contrast: 0,
    signature: null,
    sourceWidth,
    sourceHeight,
    analysisWidth: 0,
    analysisHeight: 0,
    points: null,
    areaRatio: 0,
    message,
    signatureSource: "center-content-motion"
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
