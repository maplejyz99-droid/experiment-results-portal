(function installPortalHeroMesh(global) {
  "use strict";

  const GRID_W = 96;
  const GRID_H = 40;
  const FORCE = 1.5;
  const SPRING_K = 0.08;
  const DAMPING = 0.9;
  const DT = 0.1;
  const ACTIVITY_EPSILON = 0.00008;
  const MAX_DPR = 2;
  const MAX_INIT_ATTEMPTS = 3;
  const INIT_RETRY_DELAY_MS = 120;
  let activeRuntimeCleanup = null;
  let installRetryTimer = 0;

  const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
in vec2 aUv;
in vec2 aDisp;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPos + aDisp, 0.0, 1.0);
  vUv = aUv;
}`;

  const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  outColor = texture(uTex, vUv);
}`;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  }

  function finiteCssNumber(value, fallback) {
    const parsed = Number.parseFloat(String(value || ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function titleLinesFromLayout(title) {
    const words = [];
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = String(node.nodeValue || "");
      for (const match of text.matchAll(/\S+/gu)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          words.push({ text: match[0], top: rect.top });
        }
      }
      node = walker.nextNode();
    }

    if (!words.length) return [String(title.textContent || "").trim()];
    const lines = [];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || Math.abs(current.top - word.top) > 2) {
        lines.push({ top: word.top, words: [word.text] });
      } else {
        current.words.push(word.text);
      }
    }
    return lines.map((line) => line.words.join(" "));
  }

  function drawLineWithSpacing(context, text, centerX, centerY, letterSpacing) {
    if ("letterSpacing" in context) {
      context.letterSpacing = `${letterSpacing}px`;
      context.textAlign = "center";
      context.fillText(text, centerX, centerY);
      return;
    }

    const glyphs = Array.from(text);
    const widths = glyphs.map((glyph) => context.measureText(glyph).width);
    const lineWidth =
      widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, glyphs.length - 1) * letterSpacing;
    let x = centerX - lineWidth / 2;
    context.textAlign = "left";
    glyphs.forEach((glyph, index) => {
      context.fillText(glyph, x, centerY);
      x += widths[index] + letterSpacing;
    });
  }

  function renderTitleTexture(title, width, height, dpr) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = width;
    textureCanvas.height = height;
    const context = textureCanvas.getContext("2d");
    if (!context) return null;

    const style = global.getComputedStyle(title);
    const fontSize = finiteCssNumber(style.fontSize, 124) * dpr;
    const lineHeight = finiteCssNumber(style.lineHeight, fontSize / dpr) * dpr;
    const letterSpacing = finiteCssNumber(style.letterSpacing, 0) * dpr;
    const lines = titleLinesFromLayout(title);
    const totalHeight = lineHeight * lines.length;
    const firstCenter = (height - totalHeight) / 2 + lineHeight / 2;

    context.clearRect(0, 0, width, height);
    context.fillStyle = style.color || "#0b132b";
    context.textBaseline = "middle";
    context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    context.fontKerning = "normal";
    lines.forEach((line, index) => {
      drawLineWithSpacing(
        context,
        line,
        width / 2,
        firstCenter + index * lineHeight,
        letterSpacing
      );
    });
    return textureCanvas;
  }

  function deleteGpuResources(gl, resources) {
    if (!gl || gl.isContextLost()) return;
    for (const buffer of resources.buffers) {
      if (buffer) gl.deleteBuffer(buffer);
    }
    if (resources.texture) gl.deleteTexture(resources.texture);
    if (resources.vao) gl.deleteVertexArray(resources.vao);
    if (resources.program) gl.deleteProgram(resources.program);
    if (resources.vertexShader) gl.deleteShader(resources.vertexShader);
    if (resources.fragmentShader) gl.deleteShader(resources.fragmentShader);
  }

  function clearInstallRetry() {
    if (!installRetryTimer) return;
    global.clearTimeout(installRetryTimer);
    installRetryTimer = 0;
  }

  function scheduleInstall(attempt = 0, delay = 0) {
    clearInstallRetry();
    if (activeRuntimeCleanup) return;

    const start = () => {
      installRetryTimer = 0;
      if (activeRuntimeCleanup) return;
      const result = install();
      if (result === "retry" && attempt + 1 < MAX_INIT_ATTEMPTS) {
        scheduleInstall(
          attempt + 1,
          INIT_RETRY_DELAY_MS * Math.max(1, attempt + 1)
        );
      }
    };

    if (delay > 0) {
      installRetryTimer = global.setTimeout(start, delay);
    } else {
      start();
    }
  }

  function install() {
    if (activeRuntimeCleanup) return "ready";
    const wrapper = document.querySelector("[data-hero-mesh]");
    const title = wrapper?.querySelector("h1");
    const canvas = wrapper?.querySelector("canvas");
    const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)");
    const finePointer = global.matchMedia?.("(hover: hover) and (pointer: fine)");
    if (
      !wrapper ||
      !title ||
      !canvas ||
      reducedMotion?.matches ||
      finePointer?.matches === false ||
      typeof global.ResizeObserver !== "function"
    ) {
      return "unsupported";
    }

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    if (!gl) return "retry";

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      return "retry";
    }
    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return "retry";
    }

    const vertexCount = (GRID_W + 1) * (GRID_H + 1);
    const positions = new Float32Array(vertexCount * 2);
    const uvs = new Float32Array(vertexCount * 2);
    for (let y = 0; y <= GRID_H; y += 1) {
      for (let x = 0; x <= GRID_W; x += 1) {
        const index = y * (GRID_W + 1) + x;
        const u = x / GRID_W;
        const v = y / GRID_H;
        positions[index * 2] = u * 2 - 1;
        positions[index * 2 + 1] = 1 - v * 2;
        uvs[index * 2] = u;
        uvs[index * 2 + 1] = v;
      }
    }

    const indexCount = GRID_W * GRID_H * 6;
    const indices = new Uint32Array(indexCount);
    let offset = 0;
    for (let y = 0; y < GRID_H; y += 1) {
      for (let x = 0; x < GRID_W; x += 1) {
        const a = y * (GRID_W + 1) + x;
        const b = a + 1;
        const c = a + GRID_W + 1;
        const d = c + 1;
        indices[offset++] = a;
        indices[offset++] = c;
        indices[offset++] = b;
        indices[offset++] = b;
        indices[offset++] = c;
        indices[offset++] = d;
      }
    }

    const displacement = new Float32Array(vertexCount * 2);
    const velocity = new Float32Array(vertexCount * 2);
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    const displacementBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const resources = {
      buffers: [positionBuffer, uvBuffer, displacementBuffer, indexBuffer],
      texture,
      vao,
      program,
      vertexShader,
      fragmentShader,
    };
    if (
      !vao ||
      !positionBuffer ||
      !uvBuffer ||
      !displacementBuffer ||
      !indexBuffer ||
      !texture
    ) {
      wrapper.classList.remove("is-mesh-ready");
      deleteGpuResources(gl, resources);
      return "retry";
    }

    const positionLocation = gl.getAttribLocation(program, "aPos");
    const uvLocation = gl.getAttribLocation(program, "aUv");
    const displacementLocation = gl.getAttribLocation(program, "aDisp");
    const textureLocation = gl.getUniformLocation(program, "uTex");
    if (
      positionLocation < 0 ||
      uvLocation < 0 ||
      displacementLocation < 0 ||
      !textureLocation
    ) {
      wrapper.classList.remove("is-mesh-ready");
      deleteGpuResources(gl, resources);
      return "retry";
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, displacementBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, displacement, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(displacementLocation);
    gl.vertexAttribPointer(displacementLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const cursor = {
      x: 99,
      y: 99,
      previousX: 99,
      previousY: 99,
      inside: false,
    };
    let frameId = 0;
    let textureReady = false;
    let sectionVisible = true;
    let rebuildGeneration = 0;
    let contextLost = false;
    let destroyed = false;

    function drawFrame() {
      if (destroyed || contextLost || !textureReady || gl.isContextLost()) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, displacementBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, displacement);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textureLocation, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
    }

    function resetMesh() {
      displacement.fill(0);
      velocity.fill(0);
      cursor.x = 99;
      cursor.y = 99;
      cursor.previousX = 99;
      cursor.previousY = 99;
      cursor.inside = false;
      drawFrame();
    }

    function shouldAnimate() {
      return Boolean(
        sectionVisible &&
          !document.hidden &&
          !reducedMotion?.matches &&
          finePointer?.matches !== false &&
          textureReady &&
          !contextLost &&
          !destroyed
      );
    }

    function requestFrame() {
      if (!frameId && shouldAnimate()) {
        frameId = global.requestAnimationFrame(tick);
      }
    }

    function tick() {
      frameId = 0;
      if (!shouldAnimate()) return;

      let cursorVelocityX = cursor.x - cursor.previousX;
      let cursorVelocityY = cursor.y - cursor.previousY;
      if (Math.hypot(cursorVelocityX, cursorVelocityY) > 0.3) {
        cursorVelocityX = 0;
        cursorVelocityY = 0;
      }
      cursor.previousX = cursor.x;
      cursor.previousY = cursor.y;

      let activity = 0;
      for (let index = 0; index < vertexCount; index += 1) {
        const index2 = index * 2;
        const dx = displacement[index2];
        const dy = displacement[index2 + 1];
        const cursorDx = cursor.x - (positions[index2] + dx);
        const cursorDy = cursor.y - (positions[index2 + 1] + dy);
        const cursorDistance = Math.hypot(cursorDx, cursorDy);
        const proximity = Math.max(0, 1 / (1 + cursorDistance / 0.05) - 0.1);

        let velocityX = velocity[index2];
        let velocityY = velocity[index2 + 1];
        velocityX += cursorVelocityX * FORCE * proximity;
        velocityY += cursorVelocityY * FORCE * proximity;
        velocityX = (velocityX - dx * SPRING_K) * DAMPING;
        velocityY = (velocityY - dy * SPRING_K) * DAMPING;

        const nextDx = Math.max(-1, Math.min(1, dx + velocityX * DT));
        const nextDy = Math.max(-1, Math.min(1, dy + velocityY * DT));
        velocity[index2] = velocityX;
        velocity[index2 + 1] = velocityY;
        displacement[index2] = nextDx;
        displacement[index2 + 1] = nextDy;
        activity = Math.max(
          activity,
          Math.abs(velocityX),
          Math.abs(velocityY),
          Math.abs(nextDx),
          Math.abs(nextDy)
        );
      }

      drawFrame();
      if (activity > ACTIVITY_EPSILON) requestFrame();
    }

    async function rebuildTexture() {
      if (destroyed || contextLost || gl.isContextLost()) return;
      const generation = ++rebuildGeneration;
      const dpr = Math.min(MAX_DPR, Math.max(1, global.devicePixelRatio || 1));
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(2, Math.round(rect.width * dpr));
      const height = Math.max(2, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);

      try {
        await document.fonts?.ready;
        const style = global.getComputedStyle(title);
        await document.fonts?.load?.(
          `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        );
      } catch {
        // Canvas will use the same browser font fallback as the semantic title.
      }
      if (
        destroyed ||
        contextLost ||
        generation !== rebuildGeneration ||
        gl.isContextLost()
      ) {
        return;
      }

      const textureCanvas = renderTitleTexture(title, width, height, dpr);
      if (!textureCanvas) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        textureCanvas
      );
      textureReady = true;
      resetMesh();
      wrapper.classList.add("is-mesh-ready");
    }

    function onPointerMove(event) {
      if (!shouldAnimate()) return;
      const rect = wrapper.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      if (!cursor.inside) {
        cursor.previousX = x;
        cursor.previousY = y;
        cursor.inside = true;
      }
      cursor.x = x;
      cursor.y = y;
      requestFrame();
    }

    function onPointerLeave() {
      cursor.inside = false;
      cursor.x = 99;
      cursor.y = 99;
      requestFrame();
    }

    function onMotionPreferenceChange() {
      if (reducedMotion?.matches || finePointer?.matches === false) {
        if (frameId) global.cancelAnimationFrame(frameId);
        frameId = 0;
        resetMesh();
        wrapper.classList.remove("is-mesh-ready");
        return;
      }
      if (textureReady) wrapper.classList.add("is-mesh-ready");
    }

    function onVisibilityChange() {
      if (!document.hidden) return;
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = 0;
      resetMesh();
    }

    function onContextLost(event) {
      event.preventDefault();
      contextLost = true;
      rebuildGeneration += 1;
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = 0;
      textureReady = false;
      wrapper.classList.remove("is-mesh-ready");
    }

    function onContextRestored() {
      contextLost = false;
      cleanup({ releaseContext: false });
      scheduleInstall();
    }

    const resizeObserver = new global.ResizeObserver(() => {
      void rebuildTexture();
    });
    resizeObserver.observe(wrapper);

    const heroScreen = wrapper.closest(".hero-screen");
    const intersectionObserver =
      heroScreen && typeof global.IntersectionObserver === "function"
        ? new global.IntersectionObserver(
            (entries) => {
              sectionVisible = entries.some((entry) => entry.isIntersecting);
              if (!sectionVisible) {
                if (frameId) global.cancelAnimationFrame(frameId);
                frameId = 0;
                resetMesh();
              }
            },
            { threshold: 0.02 }
          )
        : null;
    if (heroScreen) intersectionObserver?.observe(heroScreen);

    wrapper.addEventListener("pointermove", onPointerMove, { passive: true });
    wrapper.addEventListener("pointerleave", onPointerLeave, { passive: true });
    reducedMotion?.addEventListener?.("change", onMotionPreferenceChange);
    finePointer?.addEventListener?.("change", onMotionPreferenceChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    function cleanup({ releaseContext = false } = {}) {
      if (destroyed) return;
      destroyed = true;
      rebuildGeneration += 1;
      if (frameId) global.cancelAnimationFrame(frameId);
      frameId = 0;
      textureReady = false;
      wrapper.classList.remove("is-mesh-ready");

      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerleave", onPointerLeave);
      reducedMotion?.removeEventListener?.("change", onMotionPreferenceChange);
      finePointer?.removeEventListener?.("change", onMotionPreferenceChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);

      deleteGpuResources(gl, resources);
      if (releaseContext && !gl.isContextLost()) {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      if (activeRuntimeCleanup === cleanup) activeRuntimeCleanup = null;
    }

    activeRuntimeCleanup = cleanup;

    void rebuildTexture();
    return "ready";
  }

  function destroy({ releaseContext = false } = {}) {
    clearInstallRetry();
    activeRuntimeCleanup?.({ releaseContext });
  }

  function onPageHide(event) {
    destroy({ releaseContext: !event.persisted });
  }

  function onPageShow() {
    if (!activeRuntimeCleanup) scheduleInstall();
  }

  global.addEventListener("pagehide", onPageHide);
  global.addEventListener("pageshow", onPageShow);

  const api = Object.freeze({
    install: () => scheduleInstall(),
    destroy,
  });
  global.PortalHeroMesh = api;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scheduleInstall(), {
      once: true,
    });
  } else {
    scheduleInstall();
  }
})(globalThis);
