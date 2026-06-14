const PDF_PAGE = {
  portrait: [595.28, 841.89],
  landscape: [841.89, 595.28]
};

export function capturePage({ video, sourceCanvas, detection, pageNumber }) {
  sourceCanvas.width = video.videoWidth;
  sourceCanvas.height = video.videoHeight;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);

  const image = createFrameImage(sourceCanvas);

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    number: pageNumber,
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    signature: detection?.signature ?? null,
    quality: detection?.quality ?? 0,
    capturedAt: new Date()
  };
}

export function exportPagesToPdf(pages) {
  const pdfBlob = createPdfBlob(pages);
  downloadBlob(pdfBlob, `paper-sweep-${formatDate(new Date())}.pdf`);
}

export async function exportPagesToZip(pages) {
  if (!pages.length) {
    throw new Error("No saved documents to export.");
  }

  const { JSZip } = window;
  if (!JSZip) {
    throw new Error("ZIP engine is not available yet.");
  }

  const zip = new JSZip();
  zip.file("paper-sweep.pdf", createPdfBlob(pages));

  const manifest = {
    app: "Paper Sweep",
    exportedAt: new Date().toISOString(),
    pages: pages.map((page, index) => {
      const selectedName = imageFileName("selected", index + 1);
      const candidates = exportCandidates(page).map((candidate, candidateIndex) => ({
        file: imageFileName(`candidate-${candidateIndex + 1}`, index + 1),
        quality: Math.round(candidate.quality || 0),
        sharpness: roundMetric(candidate.sharpness),
        paperPresence: roundMetric(candidate.paperPresence),
        score: roundMetric(candidate.score),
        capturedAtMs: Math.round(candidate.capturedAtMs || 0)
      }));

      return {
        page: index + 1,
        selectedFile: selectedName,
        selectedQuality: Math.round(page.reviewQuality ?? page.quality ?? 0),
        selectedSharpness: roundMetric(page.reviewSharpness),
        selectedPaperPresence: roundMetric(page.reviewPaperPresence),
        candidates
      };
    })
  };

  pages.forEach((page, index) => {
    zip.file(`selected/${imageFileName("selected", index + 1)}`, dataUrlToBase64(page.dataUrl), { base64: true });
    exportCandidates(page).forEach((candidate, candidateIndex) => {
      zip.file(
        `candidates/${imageFileName(`candidate-${candidateIndex + 1}`, index + 1)}`,
        dataUrlToBase64(candidate.dataUrl),
        { base64: true }
      );
    });
  });
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 }
  });
  downloadBlob(zipBlob, `paper-sweep-${formatDate(new Date())}.zip`);
}

function createPdfBlob(pages) {
  if (!pages.length) {
    throw new Error("No saved documents to export.");
  }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    throw new Error("PDF engine is not available yet.");
  }

  let pdf = null;

  pages.forEach((page, index) => {
    const orientation = page.width > page.height ? "landscape" : "portrait";
    const [pageWidth, pageHeight] = PDF_PAGE[orientation];

    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: "pt", format: [pageWidth, pageHeight] });
    } else {
      pdf.addPage([pageWidth, pageHeight], orientation);
    }

    const margin = 18;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const imageRatio = page.width / page.height;
    const frameRatio = maxWidth / maxHeight;
    const drawWidth = imageRatio > frameRatio ? maxWidth : maxHeight * imageRatio;
    const drawHeight = imageRatio > frameRatio ? maxWidth / imageRatio : maxHeight;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    pdf.addImage(page.dataUrl, "JPEG", x, y, drawWidth, drawHeight, undefined, "FAST");
  });

  return pdf.output("blob");
}

function createFrameImage(sourceCanvas) {
  const maxLongSide = 1900;
  const scale = Math.min(1, maxLongSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceCanvas.width * scale);
  canvas.height = Math.round(sourceCanvas.height * scale);
  canvas.getContext("2d").drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width: canvas.width,
    height: canvas.height
  };
}

function exportCandidates(page) {
  const selected = page.dataUrl;
  return (page.candidates || [])
    .filter((candidate) => candidate.dataUrl && candidate.dataUrl !== selected)
    .filter((candidate) => candidate.quality >= 52 && candidate.sharpness >= 12)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 2);
}

function imageFileName(kind, pageNumber) {
  return `shot-${pageNumber.toString().padStart(2, "0")}-${kind}.jpg`;
}

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1] || "";
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function roundMetric(value) {
  return Number((value || 0).toFixed(2));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
