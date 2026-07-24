import type { Point, QualityProfile, ZoneGeometry } from "./types";

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * .5 + .5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision highp float;
  uniform sampler2D u_camera;
  uniform float u_effect;
  uniform float u_opacity;
  uniform vec2 u_resolution;
  uniform float u_video_aspect;
  uniform float u_canvas_aspect;
  varying vec2 v_uv;

  float luminance(vec3 color) {
    return dot(color, vec3(.299, .587, .114));
  }

  float hash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec3 sampleCamera(vec2 uv) {
    vec2 cropped = uv;
    if (u_video_aspect > u_canvas_aspect) {
      cropped.x = (cropped.x - .5) * (u_canvas_aspect / u_video_aspect) + .5;
    } else {
      cropped.y = (cropped.y - .5) * (u_video_aspect / u_canvas_aspect) + .5;
    }
    vec2 mirrored = vec2(1.0 - cropped.x, cropped.y);
    return texture2D(u_camera, clamp(mirrored, .001, .999)).rgb;
  }

  void main() {
    vec3 source = sampleCamera(v_uv);
    if (u_effect < -.5) {
      gl_FragColor = vec4(pow(source, vec3(.94)), 1.0);
      return;
    }

    float light = luminance(source);
    float grain = hash(floor(gl_FragCoord.xy * .72));
    vec3 color;

    if (u_effect < .5) {
      float ink = smoothstep(.2, .82, light + (grain - .5) * .16);
      vec3 blue = vec3(.025, .23, .47);
      vec3 paper = vec3(.89, .9, .82);
      color = mix(blue, paper, ink);
    } else if (u_effect < 1.5) {
      vec2 offset = vec2(2.0 / u_resolution.x, 0.0);
      float warm = luminance(sampleCamera(v_uv + offset));
      float cool = luminance(sampleCamera(v_uv - offset));
      float greenInk = step(light + (grain - .5) * .12, .62);
      float yellowInk = step(warm, .76);
      color = vec3(.94, .83, .12) * yellowInk;
      color = mix(color, vec3(.02, .45, .27), greenInk * .86);
      color += vec3(.84, .86, .72) * step(.84, cool) * .38;
    } else if (u_effect < 2.5) {
      vec2 cell = mod(gl_FragCoord.xy, 9.0) - 4.5;
      float radius = mix(1.0, 5.7, 1.0 - light);
      float dotMask = 1.0 - smoothstep(radius - .8, radius, length(cell));
      vec3 paper = vec3(.91, .88, .8);
      vec3 red = vec3(.78, .09, .075);
      color = mix(paper, red, dotMask);
    } else {
      vec2 cell = mod(gl_FragCoord.xy, 5.0) - 2.5;
      float threshold = hash(floor(gl_FragCoord.xy / 5.0));
      float mark = step(light + threshold * .32, .72);
      float dotMask = mark * (1.0 - smoothstep(1.0, 2.35, length(cell)));
      color = mix(vec3(.9, .88, .81), vec3(.055, .06, .05), dotMask);
    }

    float border = min(
      min(v_uv.x, 1.0 - v_uv.x),
      min(v_uv.y, 1.0 - v_uv.y)
    );
    color *= 1.0 - smoothstep(.035, 0.0, border) * .07;
    gl_FragColor = vec4(color, u_opacity);
  }
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader unavailable");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader failed");
  }
  return shader;
}

function clipPoint(point: Point): [number, number] {
  return [point.x * 2 - 1, 1 - point.y * 2];
}

function zoneVertices(zone: ZoneGeometry) {
  const [a, b, c, d] = zone.points.map(clipPoint);
  return new Float32Array([
    a[0],
    a[1],
    b[0],
    b[1],
    d[0],
    d[1],
    d[0],
    d[1],
    b[0],
    b[1],
    c[0],
    c[1],
  ]);
}

export type PrintRenderer = {
  render: (
    video: HTMLVideoElement,
    zones: ZoneGeometry[],
    opacity: number,
    quality: QualityProfile,
  ) => void;
  destroy: () => void;
};

export function createPrintRenderer(
  canvas: HTMLCanvasElement,
): PrintRenderer {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("WebGL is not supported");

  const program = gl.createProgram();
  if (!program) throw new Error("WebGL program unavailable");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL link failed");
  }
  gl.useProgram(program);

  const position = gl.getAttribLocation(program, "a_position");
  const effect = gl.getUniformLocation(program, "u_effect");
  const opacityLocation = gl.getUniformLocation(program, "u_opacity");
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const videoAspect = gl.getUniformLocation(program, "u_video_aspect");
  const canvasAspect = gl.getUniformLocation(program, "u_canvas_aspect");
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) throw new Error("WebGL resources unavailable");

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const fullScreen = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]);

  return {
    render(video, zones, zoneOpacity, quality) {
      const width = Math.min(
        1440,
        Math.max(1, Math.round(canvas.clientWidth * quality.renderScale)),
      );
      const height = Math.min(
        1440,
        Math.max(1, Math.round(canvas.clientHeight * quality.renderScale)),
      );
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(
        videoAspect,
        video.videoWidth && video.videoHeight
          ? video.videoWidth / video.videoHeight
          : width / height,
      );
      gl.uniform1f(
        canvasAspect,
        canvas.clientWidth && canvas.clientHeight
          ? canvas.clientWidth / canvas.clientHeight
          : width / height,
      );
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, fullScreen, gl.DYNAMIC_DRAW);
      gl.uniform1f(effect, -1);
      gl.uniform1f(opacityLocation, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      for (const zone of zones) {
        gl.bufferData(
          gl.ARRAY_BUFFER,
          zoneVertices(zone),
          gl.DYNAMIC_DRAW,
        );
        gl.uniform1f(effect, zone.effect);
        gl.uniform1f(opacityLocation, zoneOpacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
