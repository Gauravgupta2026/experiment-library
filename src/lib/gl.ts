const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

export interface Quad {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  /** Set a float, vec2, vec3 uniform by name. Unknown names are ignored (the compiler may remove unused ones). */
  set(name: string, ...v: number[]): void;
  /** Bind a 2D texture source to a sampler uniform on the given unit. */
  texture(name: string, unit: number, source: TexImageSource | null, linear?: boolean): void;
  draw(): void;
  resize(width: number, height: number, dpr: number): void;
  destroy(): void;
}

/**
 * A full-screen fragment shader on one canvas. Raw WebGL1: no library is needed for a single triangle.
 * Rebuilds itself after a context loss.
 */
export function createQuad(canvas: HTMLCanvasElement, frag: string, onRestore?: () => void): Quad {
  const ctx = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!ctx) throw new Error('WebGL is not available');
  const gl: WebGLRenderingContext = ctx;
  let program: WebGLProgram | null = null;
  let locations = new Map<string, WebGLUniformLocation | null>();
  const textures = new Map<number, WebGLTexture>();

  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type);
    if (!s) throw new Error('Cannot create shader');
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compile error');
    return s;
  };
  const build = (): void => {
    const p = gl.createProgram();
    if (!p) throw new Error('Cannot create program');
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Program link error');
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    // One triangle that covers the clip space.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    program = p; locations = new Map(); textures.clear();
  };
  build();

  const loc = (name: string): WebGLUniformLocation | null => {
    if (!locations.has(name) && program) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };
  const onLost = (e: Event): void => { e.preventDefault(); };
  const onRestored = (): void => { build(); onRestore?.(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    gl, canvas,
    set(name, ...v) {
      const l = loc(name);
      if (!l) return;
      if (v.length === 1) gl.uniform1f(l, v[0] ?? 0);
      else if (v.length === 2) gl.uniform2f(l, v[0] ?? 0, v[1] ?? 0);
      else if (v.length === 3) gl.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
      else gl.uniform4f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
    },
    texture(name, unit, source, linear = true) {
      let tex = textures.get(unit);
      if (!tex) {
        const t = gl.createTexture();
        if (!t) return;
        tex = t; textures.set(unit, tex);
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (source) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const f = linear ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      const l = loc(name);
      if (l) gl.uniform1i(l, unit);
    },
    draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      const l = loc('uRes');
      if (l) gl.uniform2f(l, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    resize(width, height, dpr) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    },
    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/** Make a canvas that fills its parent. */
export function fillCanvas(parent: HTMLElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  parent.appendChild(c);
  return c;
}
