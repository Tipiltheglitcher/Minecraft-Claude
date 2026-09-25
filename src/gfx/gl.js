// Utilitaires WebGL2

export function createProgram(gl, vsSrc, fsSrc, name = '') {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('Erreur de shader ' + name + ' : ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Erreur de liaison ' + name + ' : ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const nm = info.name.replace(/\[0\]$/, '');
    uniforms[nm] = gl.getUniformLocation(p, info.name);
  }
  return { program: p, u: uniforms };
}

// Texture tableau 2D à partir de calques RGBA (taille size x size), mipmaps manuels préservant l'alpha
export function createTextureArray(gl, layers, size, opts = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  const levels = opts.mipmaps ? Math.min(opts.maxLevel ?? 4, Math.log2(size)) : 0;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels + 1, gl.RGBA8, size, size, layers.length);
  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < layers.length; i++) {
    buf.set(layers[i]);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let src = layers[i];
    let s = size;
    for (let lv = 1; lv <= levels; lv++) {
      const ns = s >> 1;
      const dst = new Uint8Array(ns * ns * 4);
      for (let y = 0; y < ns; y++)
        for (let x = 0; x < ns; x++) {
          let r = 0, g = 0, b = 0, a = 0, n = 0, amax = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const o = ((y * 2 + dy) * s + x * 2 + dx) * 4;
              const al = src[o + 3];
              if (al > amax) amax = al;
              if (al > 0) { r += src[o]; g += src[o + 1]; b += src[o + 2]; n++; }
              a += al;
            }
          const o = (y * ns + x) * 4;
          if (n) { dst[o] = r / n; dst[o + 1] = g / n; dst[o + 2] = b / n; }
          dst[o + 3] = opts.keepAlpha ? amax : a / 4;
        }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lv, 0, 0, i, ns, ns, 1, gl.RGBA, gl.UNSIGNED_BYTE, dst);
      src = dst;
      s = ns;
    }
  }
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, levels ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels);
  return t;
}

// Configure les attributs du format de sommet commun (20 octets)
export function setupVertexAttribs(gl) {
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.SHORT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.UNSIGNED_BYTE, false, 20, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, false, 20, 10);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 20, 12);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 20, 16);
}
