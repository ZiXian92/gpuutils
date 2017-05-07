# ZX GPGPU Utils
Utility wrapper for building simple general-purpose data manipulation programs on GPU.

## Why I created this
I was quite interested in using parallelism to speed up programs after an introductory course to Parallel and Concurrent Programming. So I thought maybe there might be problems on client-side web applications that can be solved faster using WebGL(turns out I can't come up with anything other than the classical matrix multiplication). This project was mainly inspired by [GPU.JS](http://gpu.rocks/) project for my own learning on how to piece code that runs on GPU from scratch, but lacks the ability to parse JS functions into shader code and other optimizations of GPU.JS.  

Even though this project is not as powerful, feel free to give it a try if you only need to crunch numbers and don't mind writing GL Shader Language code :)

## Sample Application Project(s)
- [WebGPU](https://zixian92.github.io/webgpu/)

## What this is for
This wrapper is implemented with general-purpose computation in mind, so
rendering a scene object by object is NOT possible as the geometry and
vertex shader are hard-fixed into the compiled WebGL program.

## How it Works
Data transformations that are parallelizable on GPU can be modelled as texture-mapping or texture-filtering, where each data element is represented by a pixel. Thus the transformation is implemented in the fragment shader, in which the program is executed on a per-pixel basis.  

The fragment shader should only care about the pixel it is responsible for. The pixel/texture coordinates is in the `varying vec2 vTextureCoord;` variable.

## Notes on Writing Fragment Shader
All fragment shaders must have `gpuutils.headerSrc` string value at the start. This defines texture coordinates variable, as well as output texture `width` and `height` uniforms. You do not need to care about these variables when compiling program and binding uniforms, these will be taken care of by `gpuutils`.  

For each texture/matrix that will be used in computation, use `sample2D` type to represent it as the program is compiled using 2D textures. For 1D matrix/texture, pass in `1` to `height` or `numRows` parameters.

This wrapper only deals with 32-bit floating point numbers, which are split into 4 byte-elements in the texture. To use the original value in the fragment shader, be sure to include the predefined `gpuutils.packValueSrc` and `gpuutils.unpackValueSrc` function strings in your fragment shader. The functions can be accessed in the fragment shader with signatures `vec4 packValue(float)` and `float unpackValue(vec4)`.

## How to use
Download `gpuutils.js` from this repository into your project.  

Build your own GPU-parallelized programs through `gpuutils` API.

If you are using NodeJS' module import system, make sure you have a build task that transpiles ES6 code as browsers do not support import/export syntax. Otherwise, delete the export line from the file, but be sure to include this file before any other JS files that uses `gpuutils` object.

## API
### GPUUtils
Importing the module or linking it in HTML defines the `gpuutils` variable. Using the below methods is just invoking it on the `gpuutils` variable.   

The following is/are the publicly exposed methods. No one can stop you from digging into the source code, using/hacking the methods that are not exposed in the documentation here. However, it is your own fault if you do not understand the graphics rendering pipeline stages, call the methods in the wrong order, or missed out some data/buffer/texture binding. Sticking to the example usage below will get you just fine.

**makeKernel(String fragmentShaderSrc, Array<String> uniformVariableNames):** Creates a per-pixel/element GPU kernel, hereafter known as `GPUKernelProgram`. Refer to its own section for usage details. Returns `null` if WebGL is not supported or if fragment shader compilation fails.

### GPUKernelProgram
**(dataArrays, dataInfo, uniforms, width, height):** Executes the compiled kernel program on the given input data, returning a matrix of numbers.  
*Parameters*  

| Name | Type | Comments |
| ---- | --- | --- |
| dataArrays | Array&lt;Array&lt;Number&#124;Array&lt;Number&gt;&gt;&gt; | An array of textures/matrices. If it should be a 1-dimensional matrix, use Array&lt;Number&gt;. Otherwise it is 2-dimensional, so use Array&lt;Array&lt;Number&gt;&gt;. |
| dataInfo | Array&lt;{ name: String, width: Integer, height: Integer }&gt; | Descriptors for the matrices/textures passed in. Ordering should be the same as in `dataArrays`. `name` should match the corresponding `sampler2D` variable to be described. `width` and `height` describes the dimensions of the matrix/texture. |
| uniforms | { &lt;fragmentShaderVariableName&gt;: { type: String, value: Any }} | This is used to bind values to all uniform variables in your fragment shader. Each `fragmentShaderVariableName` should exactly match to the corresponding uniform variable name in your program. The `type` attribute is any of the supported uniform variable types(refer to page 8 of [TyphoonLabs GLSL Tutorial](https://www.opengl.org/sdk/docs/tutorials/TyphoonLabs/Chapter_1.pdf)) except any data type that starts with `sampler`. The `value` attribute is the value to be bound to that uniform variable. |
| width | Integer | The width of the output matrix |
| height | Integer | The height of the output matrix |  

*Returns*  
A 1D array if `height` is specified as 1 or 2D array otherwise.

## Example Usage
The following example shows a program to do matrix multiplication.
```javascript
const fragmentShaderSrc = `
${gpuutils.headerSrc}
uniform sampler2D mtx1;
uniform sampler2D mtx2;
uniform int width1;
${gpuutils.packValueSrc}
${gpuutils.unpackValueSrc}
void main() {
  float increment = 1.0 / float(width1);
  float startCoord =  increment / 2.0;
  vec2 mtx1Coord = vec2(startCoord, vTextureCoord.t);
  vec2 mtx2Coord = vec2(vTextureCoord.s, startCoord);
  float ans = unpackValue(texture2D(mtx1, mtx1Coord)) * unpackValue(texture2D(mtx2, mtx2Coord));
  for(int k=1; k<2048; k++) {
    if (k >= width1) break;
    mtx1Coord.s += increment;
    mtx2Coord.t += increment;
    ans += unpackValue(texture2D(mtx1, mtx1Coord)) * unpackValue(texture2D(mtx2, mtx2Coord));
  }
  gl_FragColor = packValue(ans);
}
`
let matrixMultiply = gpuutils.makeKernel(fragmentShaderSrc, [
    'mtx1', 'mtx2', 'width1'
])

// Prepare some matrices. Assume their widths and heights are defined somewhere.
let m1 = ...
let m2 = ...
let res = matrixMultiply([m1, m2], [{
    name: 'mtx1', width: m1Width, height: m1Height
}, {
    name: 'mtx2', width: m2Width, height: m2Height
}], { width1: { type: 'int', value: m1Width } }, m2Width, m1Height)
```
