/* gpuutils.js
 * Contains utility functions to make WebGL usage more convenient.
 * Supports data only up to 2-dimensional arrays due to the nature of
 * textures.
 * Main gist taken from http://www.vizitsolutions.com/portfolio/webgl/gpgpu/
 * @author zixian92
 */

/**
 * Defines utility class for general-purpose GPU computations.
 * If you want to use some of these methods for actual drawing,
 * use libraries like three.js instead as they are more similar to OpenGL.
 * Image filtering is fine though: just get the canvas, stick the image in and
 * run your fragment shaders.
 */
class GPUUtils {
  constructor () {
    this.canvas = document.createElement('canvas')
    this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl')
    if (this.gl) {
      this.initGlContext()
      this.gl.getExtension('OES_texture_float')
      this.frameBuffer = this.gl.createFramebuffer()

      // Pre-compile vertex shader for GPGPU operations.
      // This is to save programmers the trouble of repeating the
      // same vertex shader each time.
      this.vShader = this.gl.createShader(this.gl.VERTEX_SHADER)
      this.gl.shaderSource(this.vShader, GPUUtils.vertexShaderSrc)
      this.gl.compileShader(this.vShader)
      console.log('Compiling vertex shader')
      let vShaderCompileLog = this.gl.getShaderInfoLog(this.vShader)
      if (vShaderCompileLog) console.log(vShaderCompileLog)

      // Set up beffer for vertex shader
      this.vertexTextureCoordsBuffer = this.gl.createBuffer()
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexTextureCoordsBuffer)
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(GPUUtils.vertexTextureCoords), this.gl.STATIC_DRAW)
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)
    } else {
      console.log('WebGL not supported')
    }
  }

  // Initializes the WebGL rendering context
  initGlContext () {
    if (!this.gl) return
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.enable(this.gl.DEPTH_TEST)
    this.gl.depthFunc(this.gl.LEQUAL)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)
  }

  /**
   * Sets the canvas and viewport size to reflect the problem size.
   * @param {Number} width Positive number indicating width of canvas.
   * @param {Number} height Positive number indicating height of canvas.
   */
  setCanvasSize (width, height) {
    this.canvas.width = width
    this.canvas.height = height
    if (this.gl) this.gl.viewport(0, 0, width, height)
  }

  /**
   * Builds a float WebGLTexture out of the given data.
   * No error checking is done so make sure nRows and nCols are consistent with data.
   * @param {Array<Number>?|Array<Array<Number>>?} data Null if everything si to be set to 0. 1D or 2D array otherwise.
   * @param {Integer} nRows Number of rows in data. Set to 1 for 1D data.
   * @param {Integer} nCols Number of columns in data. Same for both 1D and 2D data.
   */
  makeTexturef (data, nRows, nCols) {
    if (!this.gl) return null

    // Set up texture data
    let textureData
    if (!data) textureData = new Uint8Array(nRows * nCols * 4)
    else if (nRows === 1) textureData = new Uint8Array(new Float32Array(data).buffer)
    else textureData = data.map(row => new Uint8Array(new Float32Array(row).buffer))
      .reduce((res, cur) => {
        let arr = new Uint8Array(res.length + cur.length)
        arr.set(res)
        arr.set(cur, res.length)
        return arr
      }, new Uint8Array(0))

    // Create and initialize texture
    let texture = this.gl.createTexture()
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST)
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, nCols, nRows, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, textureData, 0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, null)

    return texture
  }

  /**
   * Sets frame buffer to use specified texture.
   * @param {WebGLTexture} texture The texture to attach to frame buffer.
   */
  setFramebufferTexture (texture) {
    if (!this.gl) return
    let frameBuffer = this.frameBuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, frameBuffer)
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, texture, 0)

    // Get frame buffer status
    let status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER)
    switch (status) {
      case this.gl.FRAMEBUFFER_COMPLETE:
        break
      case this.gl.FRAMEBUFFER_UNSUPPORTED:
        console.log('Framebuffer unsupported')
        break
      case this.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
        console.log('Incomplete attachment')
        break
      case this.gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
        console.log('Incomplete dimensions')
        break
      case this.gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATATCHMENT:
        console.log('Missing attachment')
        break
      default:
        console.log('Unexpected error occurred')
    }
  }

  /**
   * Compiles the fragment shaders and returns the program.
   * @param {String} fragmentShaderSrc Source code for fragment shader
   * @param {Array<String>} uniformVariableNames
   * @return {(Array<Array<Number|Array<Number>>>, Array<{ name: String, width: Integer, height: Integer }>,
   *  { <name>: { <type>: String, <value>: Any }}, Integer, Integer) => Array<Number|Array<Number>>}
   *  A function that runs the shader program using the input data
   */
  makeKernel (fragmentShaderSrc, uniformVariableNames) {
    if (!this.gl) return null

    // Create and compile shader
    let fShader = this.gl.createShader(this.gl.FRAGMENT_SHADER)
    this.gl.shaderSource(fShader, fragmentShaderSrc)
    this.gl.compileShader(fShader)
    console.log('Compiling fragment shader')
    let fShaderCompileLog = this.gl.getShaderInfoLog(fShader)
    if (fShaderCompileLog) console.log(fShaderCompileLog)

    // Stop if any shader compilation fails
    // Assumes that vertex shader compilation succeeds.
    // Else this class should not be used until it is fixed!
    if (fShaderCompileLog) return null

    // Create program
    let program = this.gl.createProgram()
    this.gl.attachShader(program, this.vShader)
    this.gl.attachShader(program, fShader)
    this.gl.linkProgram(program)

    // Set up stuffs for vertex shader
    program.vertexCoordAttribute = this.gl.getAttribLocation(program, 'aVertexCoord')
    program.textureCoordAttribute = this.gl.getAttribLocation(program, 'aTextureCoord')
    this.gl.enableVertexAttribArray(program.vertexCoordAttribute)
    this.gl.enableVertexAttribArray(program.textureCoordAttribute)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexTextureCoordsBuffer)
    this.gl.vertexAttribPointer(program.vertexCoordAttribute, 3, this.gl.FLOAT, false, 20, 0)
    this.gl.vertexAttribPointer(program.textureCoordAttribute, 2, this.gl.FLOAT, false, 20, 12)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)

    // Get locations of all uniforms
    uniformVariableNames.push('width')
    uniformVariableNames.push('height')
    uniformVariableNames.forEach(n => {
      program[`${n}UniformLoc`] = this.gl.getUniformLocation(program, n)
    })

    // Return execution function
    return (dataArrays, dataInfo, uniforms, width, height) => {
      this.setCanvasSize(width, height)
      this.initGlContext()
      this.gl.useProgram(program)

      // Set output framebuffer
      let outputTexture = this.makeTexturef(null, height, width)
      this.setFramebufferTexture(outputTexture)

      // Set uniforms
      uniforms.width = { type: 'int', value: width }
      uniforms.height = { type: 'int', value: height }
      this.setUniforms(program, uniforms)

      // Load textures
      let textures = dataArrays.map((arr, i) => {
        let r = dataInfo[i].height
        let c = dataInfo[i].width
        return this.makeTexturef(arr, r, c)
      })
      textures.forEach((t, i) => {
        this.gl.activeTexture(this.gl[`TEXTURE${i}`])
        this.gl.bindTexture(this.gl.TEXTURE_2D, t)
        this.gl.uniform1i(program[`${dataInfo[i].name}UniformLoc`], i)
      })

      // Load in vertices and draw
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexTextureCoordsBuffer)
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
      let res = this.readFramebufferf(height, width)

      // Cleanup temporary resources
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
      this.gl.deleteTexture(outputTexture)
      textures.forEach((t, i) => {
        this.gl.activeTexture(this.gl[`TEXTURE${i}`])
        this.gl.bindTexture(this.gl.TEXTURE_2D, null)
        this.gl.deleteTexture(t)
      })
      return res
    }
  }

  /**
   * Sets the global constants for the program.
   * The correct program should be set before calling this method.
   * @param {{ <name>: { <type>: String, <value>: Any }}} uniforms <type> corresponds to a valid GLSL uniform type, except sampler types
   */
  setUniforms (program, uniforms) {
    for (var varName in uniforms) {
      let varProps = uniforms[varName]
      switch (varProps.type) {
        case 'bool': case 'int':
          this.gl.uniform1i(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'float':
          this.gl.uniform1f(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'vec2':
          this.gl.uniform2fv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'vec3':
          this.gl.uniform3fv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'vec4':
          this.gl.uniform4fv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'bvec2': case 'ivec2':
          this.gl.uniform2iv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'bvec3': case 'ivec3':
          this.gl.uniform3iv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'bvec4': case 'ivec4':
          this.gl.uniform4iv(program[`${varName}UniformLoc`], varProps.value)
          break
        case 'mat2':
          this.gl.uniformMatrix2fv(program[`${varName}UniformLoc`], false, varProps.value)
          break
        case 'mat3':
          this.gl.uniformMatrix3fv(program[`${varName}UniformLoc`], false, varProps.value)
          break
        case 'mat4':
          this.gl.uniformMatrix4fv(program[`${varName}UniformLoc`], false, varProps.value)
          break
        default: break
      }
    }
  }

  /**
   * Reads contents of framebuffer into matrix.
   * @param {Integer} nRows
   * @param {Integer} nCols
   * @return {Array<Number|Array<Number>>} Returns matrix on success and null if WebGL is not supported.
   */
  readFramebufferf (nRows, nCols) {
    if (!this.gl) return null

    // Read pixels and convert into Float32Array by byte interpretation
    let pixels = new Uint8Array(nRows * nCols * 4)
    this.gl.readPixels(0, 0, nCols, nRows, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels)
    pixels = new Float32Array(pixels.buffer)

    // Convert into 2D matrix
    let mtx = []
    for (let r = 0; r < nRows; r++) mtx.push(new Array(nCols))
    pixels.forEach((pixel, i) => {
      let r = Math.floor(i / nCols)
      let c = i - r * nCols
      mtx[r][c] = pixel
    })
    return nRows === 1 ? mtx[0] : mtx
  }
}

// Standard geometry for mapping the texture to entire viewport.
GPUUtils.vertexTextureCoords = [
  -1.0, -1.0, 0.0, 0.0, 0.0,
  1.0, -1.0, 0.0, 1.0, 0.0,
  -1.0, 1.0, 0.0, 0.0, 1.0,
  1.0, 1.0, 0.0, 1.0, 1.0
]

// Vertex shader thaat will be used in all GPGPU programs.
GPUUtils.vertexShaderSrc = `
#ifdef GL_ES
precision highp float;
#endif
attribute vec3 aVertexCoord;
attribute vec2 aTextureCoord;
varying vec2 vTextureCoord;

void main() {
  gl_Position = vec4(aVertexCoord, 1);
  vTextureCoord = aTextureCoord;
}
`

const gpuutils = new GPUUtils()

// High preceision declaration and other compulsory variables
gpuutils.headerSrc = `
#ifdef GL_ES
precision highp float;
#endif
varying vec2 vTextureCoord;
uniform int height;
uniform int width;
`

gpuutils.packValueSrc = `
vec4 packValue(float value) {
  float sgn = step(0.0, -value);
  value = abs(value);
  float exponent = floor(log2(value));
  float mantissa = value * pow(2.0, -exponent) - 1.0;
  exponent = exponent + 127.0;
  float a, b, g, r;
  a = floor(exponent / 2.0);
  exponent = exponent - a * 2.0;
  a = a + 128.0 * sgn;
  b = floor(128.0 * mantissa);
  mantissa = mantissa * 128.0 - b;
  b = b + 128.0 * exponent;
  g = floor(mantissa * 256.0);
  mantissa = mantissa * 256.0 - g;
  r = floor(mantissa * 256.0);
  return vec4(r, g, b, a) / vec4(255.0, 255.0, 255.0, 255.0);
}
`

gpuutils.unpackValueSrc = `
float unpackValue(vec4 bytes) {
  bytes *= vec4(255.0, 255.0, 255.0, 255.0);
  float sgn = step(128.0, bytes.a);
  float exponent = 2.0 * (bytes.a - sgn * 128.0);
  float exponentMod2 = step(128.0, bytes.b);
  exponent = exponent + exponentMod2 - 127.0;
  float mantissa = (bytes.b - exponentMod2 * 128.0) * 65536.0;
  mantissa = mantissa + bytes.g * 256.0 + bytes.r;
  return pow(-1.0, sgn) * exp2(exponent) * (1.0 + mantissa * exp2(-23.0));
}
`

export default gpuutils
