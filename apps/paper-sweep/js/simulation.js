const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

export async function createRenderedBookDataset(options = {}) {
  const count = options.count ?? 72;
  const seed = options.seed ?? 1209;
  const random = createRandom(seed);
  const THREE = await import(THREE_URL);
  const rendererState = createRendererState(THREE);
  const samples = [];
  let pageId = 1;

  while (samples.length < count) {
    samples.push(renderSample(rendererState, {
      id: `page-${pageId}-new`,
      pageId,
      hasContent: true,
      random,
      variant: "settled",
      sequence: samples.length
    }));
    if (samples.length >= count) break;

    samples.push(renderSample(rendererState, {
      id: `page-${pageId}-translate`,
      pageId,
      hasContent: true,
      random,
      variant: "same-translate",
      sequence: samples.length
    }));
    if (samples.length >= count) break;

    samples.push(renderSample(rendererState, {
      id: `page-${pageId}-zoom`,
      pageId,
      hasContent: true,
      random,
      variant: "same-zoom",
      sequence: samples.length
    }));
    if (samples.length >= count) break;

    if (pageId % 2 === 0) {
      samples.push(renderSample(rendererState, {
        id: `page-${pageId}-hand`,
        pageId,
        hasContent: true,
        random,
        variant: "same-occluded",
        sequence: samples.length
      }));
      if (samples.length >= count) break;
    }

    if (pageId % 3 === 0) {
      samples.push(renderSample(rendererState, {
        id: `flip-${pageId}`,
        pageId: null,
        hasContent: false,
        random,
        variant: "flip-transition",
        sequence: samples.length
      }));
      if (samples.length >= count) break;
    }

    pageId += 1;
  }

  rendererState.renderer.dispose();
  return samples.slice(0, count);
}

function createRendererState(THREE) {
  const width = 720;
  const height = 960;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4d5149);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 10);
  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  const keyLight = new THREE.DirectionalLight(0xfff0d6, 1.15);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 0.2;
  keyLight.shadow.camera.far = 8;
  scene.add(ambient, keyLight);

  const deskMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c655b,
    roughness: 0.88,
    metalness: 0.02
  });
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 6.8), deskMaterial);
  desk.position.z = -0.04;
  desk.receiveShadow = true;
  scene.add(desk);

  const stackMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8d5ca,
    roughness: 0.82
  });
  const stack = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 2.24), stackMaterial);
  stack.position.z = 0.005;
  stack.castShadow = true;
  stack.receiveShadow = true;
  scene.add(stack);

  const pageMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    side: THREE.DoubleSide
  });
  const page = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 2.15, 12, 12), pageMaterial);
  page.castShadow = true;
  page.receiveShadow = true;
  page.position.z = 0.045;
  scene.add(page);

  const textureCache = new Map();

  return {
    THREE,
    width,
    height,
    canvas,
    renderer,
    scene,
    camera,
    ambient,
    keyLight,
    deskMaterial,
    stack,
    page,
    textureCache
  };
}

function renderSample(state, sample) {
  const {
    THREE,
    width,
    height,
    renderer,
    scene,
    camera,
    ambient,
    keyLight,
    deskMaterial,
    stack,
    page,
    textureCache
  } = state;
  const { pageId, hasContent, random, variant } = sample;

  if (hasContent) {
    const texture = getPageTexture(THREE, textureCache, pageId);
    page.material.map = texture;
    page.material.needsUpdate = true;
    page.visible = true;
    stack.visible = true;
  } else {
    page.material.map = getPageTexture(THREE, textureCache, Math.max(1, pageId ?? 1));
    page.visible = true;
    stack.visible = true;
  }

  const pose = createPose(random, variant, sample.sequence);
  deskMaterial.color.setHSL(pose.deskHue, 0.12, pose.deskLight);
  ambient.intensity = pose.ambient;
  keyLight.intensity = pose.key;
  keyLight.color.setHSL(0.1, 0.36, pose.lightness);
  keyLight.position.set(pose.lightX, pose.lightY, pose.lightZ);

  stack.position.set(pose.pageX + 0.015, pose.pageY - 0.018, 0.01);
  stack.rotation.set(pose.tiltX * 0.45, pose.tiltY * 0.45, pose.rotation);
  stack.scale.setScalar(pose.scale * 1.02);

  page.position.set(pose.pageX, pose.pageY, pose.pageZ);
  page.rotation.set(pose.tiltX, pose.tiltY, pose.rotation);
  page.scale.set(pose.scale, pose.scale, 1);

  if (variant === "flip-transition") {
    page.rotation.y += 0.9 + random() * 0.65;
    page.rotation.z += (random() - 0.5) * 0.35;
  }

  camera.position.set(pose.cameraX, pose.cameraY, pose.cameraZ);
  camera.lookAt(pose.lookX, pose.lookY, 0);
  renderer.render(scene, camera);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.filter = pose.blur ? `blur(${pose.blur}px)` : "none";
  context.drawImage(state.canvas, 0, 0, width, height);
  context.filter = "none";

  addSensorNoise(context, random, pose);
  if (variant === "same-occluded") {
    addHandOcclusion(context, random, width, height);
  }
  if (variant === "flip-transition") {
    addMotionSmear(context, random, width, height);
  }

  return {
    id: sample.id,
    pageId,
    hasContent,
    canvas,
    variant,
    blur: Number(pose.blur.toFixed(2)),
    scale: Number(pose.scale.toFixed(2)),
    cameraZ: Number(pose.cameraZ.toFixed(2)),
    translation: Number(Math.hypot(pose.pageX, pose.pageY).toFixed(3)),
    lighting: Number((pose.ambient + pose.key).toFixed(2))
  };
}

function createPose(random, variant, sequence) {
  const shake = Math.sin(sequence * 1.7) * 0.018 + (random() - 0.5) * 0.055;
  const base = {
    pageX: (random() - 0.5) * 0.1 + shake,
    pageY: (random() - 0.5) * 0.12,
    pageZ: 0.045,
    scale: 1 + (random() - 0.5) * 0.08,
    rotation: (random() - 0.5) * 0.14,
    tiltX: (random() - 0.5) * 0.08,
    tiltY: (random() - 0.5) * 0.1,
    cameraX: (random() - 0.5) * 0.18,
    cameraY: -0.08 + (random() - 0.5) * 0.2,
    cameraZ: 3.22 + (random() - 0.5) * 0.24,
    lookX: (random() - 0.5) * 0.08,
    lookY: (random() - 0.5) * 0.08,
    ambient: 0.42 + random() * 0.55,
    key: 0.6 + random() * 1.35,
    lightness: 0.66 + random() * 0.24,
    lightX: -1.8 + random() * 3.2,
    lightY: -2.6 + random() * 2.4,
    lightZ: 2.2 + random() * 2.8,
    deskHue: 0.22 + random() * 0.16,
    deskLight: 0.32 + random() * 0.2,
    blur: random() > 0.86 ? random() * 1.1 : 0
  };

  if (variant === "same-translate") {
    base.pageX += (random() > 0.5 ? 1 : -1) * (0.18 + random() * 0.24);
    base.pageY += (random() - 0.5) * 0.34;
    base.cameraX += (random() - 0.5) * 0.18;
  }

  if (variant === "same-zoom") {
    const zoom = random() > 0.5 ? 1.18 + random() * 0.18 : 0.78 + random() * 0.14;
    base.scale *= zoom;
    base.cameraZ += zoom > 1 ? -0.34 - random() * 0.28 : 0.28 + random() * 0.32;
    base.rotation += (random() - 0.5) * 0.08;
  }

  if (variant === "same-occluded") {
    base.pageX += (random() - 0.5) * 0.28;
    base.pageY += (random() - 0.5) * 0.22;
    base.scale *= 0.92 + random() * 0.24;
  }

  if (variant === "flip-transition") {
    base.pageX += (random() - 0.5) * 0.55;
    base.pageY += (random() - 0.5) * 0.46;
    base.scale *= 0.72 + random() * 0.32;
    base.blur = 1.6 + random() * 1.9;
    base.ambient *= 0.7;
    base.key *= 0.55;
  }

  return base;
}

function getPageTexture(THREE, cache, pageId) {
  if (cache.has(pageId)) {
    return cache.get(pageId);
  }

  const random = createRandom((pageId * 2654435761) >>> 0);
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 1024;
  textureCanvas.height = 1408;
  const context = textureCanvas.getContext("2d");
  context.fillStyle = pageId % 2 ? "#f8f6ef" : "#f4f7f1";
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
  context.fillStyle = "#29322f";
  context.font = "700 54px Nunito, sans-serif";
  context.fillText(`Booklet ${pageId}`, 88, 112);
  context.font = "500 27px Nunito, sans-serif";

  for (let block = 0; block < 4; block += 1) {
    const blockTop = 178 + block * 252;
    const rows = 4 + Math.floor(random() * 4);
    context.fillStyle = block % 2 ? "#223631" : "#29322f";

    for (let row = 0; row < rows; row += 1) {
      let x = 92 + random() * 24;
      const y = blockTop + row * 38;
      const words = 5 + Math.floor(random() * 7);

      for (let word = 0; word < words; word += 1) {
        const wordWidth = 34 + random() * 128;
        const height = 7 + random() * 9;
        context.globalAlpha = 0.58 + random() * 0.34;
        context.fillRect(x, y, wordWidth, height);
        x += wordWidth + 18 + random() * 22;

        if (x > 860) {
          break;
        }
      }
    }

    if (random() > 0.45) {
      context.globalAlpha = 0.78;
      context.strokeStyle = "#29322f";
      context.lineWidth = 5;
      const left = 98 + random() * 420;
      const top = blockTop + 124 + random() * 56;
      context.strokeRect(left, top, 56 + random() * 130, 42 + random() * 48);
      if (random() > 0.5) {
        context.beginPath();
        context.moveTo(left + 12, top + 24);
        context.lineTo(left + 30, top + 42);
        context.lineTo(left + 76, top - 8);
        context.stroke();
      }
    }
  }

  context.globalAlpha = 1;
  context.strokeStyle = pageId % 2 ? "#ad6555" : "#557a69";
  context.lineWidth = 10;
  context.strokeRect(88, 1160, 260 + (pageId % 4) * 90, 96);

  context.fillStyle = pageId % 2 ? "rgba(173, 101, 85, 0.9)" : "rgba(85, 122, 105, 0.9)";
  for (let mark = 0; mark < 5; mark += 1) {
    context.save();
    context.translate(590 + random() * 300, 220 + random() * 830);
    context.rotate(-0.5 + random());
    context.fillRect(-80, 0, 90 + random() * 190, 8 + random() * 6);
    context.fillRect(-80, 24, 50 + random() * 170, 7 + random() * 5);
    context.restore();
  }

  context.globalAlpha = 0.9;
  context.fillStyle = "#29322f";
  for (let dot = 0; dot < 36; dot += 1) {
    if (random() > 0.62) {
      context.beginPath();
      context.arc(110 + random() * 780, 180 + random() * 980, 3 + random() * 8, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(pageId, texture);
  return texture;
}

function addSensorNoise(context, random, pose) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const vignette = context.createRadialGradient(width * 0.52, height * 0.46, height * 0.16, width * 0.52, height * 0.46, height * 0.7);
  vignette.addColorStop(0, "rgba(255, 255, 255, 0)");
  vignette.addColorStop(1, `rgba(0, 0, 0, ${0.12 + (1 - pose.ambient) * 0.08})`);
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.02 + random() * 0.025;
  for (let index = 0; index < 110; index += 1) {
    context.fillStyle = random() > 0.5 ? "#ffffff" : "#000000";
    context.fillRect(random() * width, random() * height, 1 + random() * 3, 1 + random() * 3);
  }
  context.globalAlpha = 1;
}

function addHandOcclusion(context, random, width, height) {
  context.save();
  context.fillStyle = "rgba(154, 107, 84, 0.82)";
  context.translate(width * (0.66 + (random() - 0.5) * 0.18), height * (0.2 + random() * 0.2));
  context.rotate(-0.52 + random() * 0.34);
  context.beginPath();
  context.ellipse(0, 0, 84 + random() * 30, 36 + random() * 18, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function addMotionSmear(context, random, width, height) {
  context.save();
  context.globalAlpha = 0.22;
  context.filter = `blur(${3 + random() * 3}px)`;
  context.drawImage(context.canvas, -28 + random() * 56, -18 + random() * 36, width, height);
  context.restore();
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
