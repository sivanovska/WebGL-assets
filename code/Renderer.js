import { vec3, mat4 } from "glm";

import * as WebGPU from "engine/WebGPU.js";

import { Camera } from "engine/core.js";
import { BaseRenderer } from "engine/renderers/BaseRenderer.js";

import {
  getLocalModelMatrix,
  getGlobalModelMatrix,
  getGlobalViewMatrix,
  getProjectionMatrix,
  getModels,
} from "engine/core/SceneUtils.js";

import { Light } from "./Light.js";

const vertexBufferLayout = {
  arrayStride: 32,
  attributes: [
    {
      name: "position",
      shaderLocation: 0,
      offset: 0,
      format: "float32x3",
    },
    {
      name: "texcoords",
      shaderLocation: 1,
      offset: 12,
      format: "float32x2",
    },
    {
      name: "normal",
      shaderLocation: 2,
      offset: 20,
      format: "float32x3",
    },
  ],
};

const cameraBindGroupLayout = {
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {},
    },
  ],
};

const lightBindGroupLayout = {
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {},
    },
  ],
};

const modelBindGroupLayout = {
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {},
    },
  ],
};

const materialBindGroupLayout = {
  entries: [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {},
    },
    {
      binding: 1,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {},
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: {},
    },
  ],
};

// Create bitmap for missing texture
const missingTextureBitmap = await fetch("./scene/missing-texture.png")
  .then((response) => response.blob())
  .then((blob) => createImageBitmap(blob));

// Temporary fix: Teleport
export function teleport(x, y, z) {
  Renderer.temp = 1;
  Renderer.teleportX = x;
  Renderer.teleportY = y;
  Renderer.teleportZ = z;
}
window.teleport = teleport;
// End of Teleport

export class Renderer extends BaseRenderer {
  constructor(canvas) {
    super(canvas);
    this.perFragment = true;
  }

  async initialize() {
    await super.initialize();

    const codePerFragment = await fetch("phongPerFragment.wgsl").then(
      (response) => response.text()
    );
    // const codePerVertex = await fetch('phongPerVertex.wgsl').then(response => response.text());

    const modulePerFragment = this.device.createShaderModule({
      code: codePerFragment,
    });
    // const modulePerVertex = this.device.createShaderModule({ code: codePerVertex });

    this.cameraBindGroupLayout = this.device.createBindGroupLayout(
      cameraBindGroupLayout
    );
    this.lightBindGroupLayout =
      this.device.createBindGroupLayout(lightBindGroupLayout);
    this.modelBindGroupLayout =
      this.device.createBindGroupLayout(modelBindGroupLayout);
    this.materialBindGroupLayout = this.device.createBindGroupLayout(
      materialBindGroupLayout
    );

    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.cameraBindGroupLayout,
        this.lightBindGroupLayout,
        this.modelBindGroupLayout,
        this.materialBindGroupLayout,
      ],
    });

    this.pipelinePerFragment = await this.device.createRenderPipelineAsync({
      vertex: {
        module: modulePerFragment,
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: modulePerFragment,
        targets: [{ format: this.format }],
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      layout,
    });

    // this.pipelinePerVertex = await this.device.createRenderPipelineAsync({
    //     vertex: {
    //         module: modulePerVertex,
    //         buffers: [ vertexBufferLayout ],
    //     },
    //     fragment: {
    //         module: modulePerVertex,
    //         targets: [{ format: this.format }],
    //     },
    //     depthStencil: {
    //         format: 'depth24plus',
    //         depthWriteEnabled: true,
    //         depthCompare: 'less',
    //     },
    //     layout,
    // });

    this.recreateDepthTexture();
  }

  recreateDepthTexture() {
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      format: "depth24plus",
      size: [this.canvas.width, this.canvas.height],
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  prepareNode(node) {
    if (this.gpuObjects.has(node)) {
      return this.gpuObjects.get(node);
    }

    const modelUniformBuffer = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const modelBindGroup = this.device.createBindGroup({
      layout: this.modelBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: modelUniformBuffer } }],
    });

    const gpuObjects = { modelUniformBuffer, modelBindGroup };
    this.gpuObjects.set(node, gpuObjects);
    return gpuObjects;
  }

  prepareCamera(camera) {
    if (this.gpuObjects.has(camera)) {
      return this.gpuObjects.get(camera);
    }

    const cameraUniformBuffer = this.device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: cameraUniformBuffer } }],
    });

    const gpuObjects = { cameraUniformBuffer, cameraBindGroup };
    this.gpuObjects.set(camera, gpuObjects);
    return gpuObjects;
  }

  prepareLight(light) {
    if (this.gpuObjects.has(light)) {
      return this.gpuObjects.get(light);
    }

    const lightUniformBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const lightBindGroup = this.device.createBindGroup({
      layout: this.lightBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: lightUniformBuffer } }],
    });

    const gpuObjects = { lightUniformBuffer, lightBindGroup };
    this.gpuObjects.set(light, gpuObjects);
    return gpuObjects;
  }

  prepareTexture(texture) {
    if (this.gpuObjects.has(texture)) {
      return this.gpuObjects.get(texture);
    }
    const { gpuTexture } = this.prepareImage(texture.image, texture.isSRGB);
    const { gpuSampler } = this.prepareSampler(texture.sampler);
    const gpuObjects = { gpuTexture, gpuSampler };
    this.gpuObjects.set(texture, gpuObjects);
    return gpuObjects;
  }

  createMonocolorBitmap(color) {
    // Make an HTML canvas with a single pixel of the desired color
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    context.fillStyle = `rgb(${color
      .map((c) => Math.round(c * 255))
      .join(",")})`;
    context.fillRect(0, 0, 1, 1);
    return canvas;
  }

  prepareMaterial(material) {
    if (this.gpuObjects.has(material)) {
      return this.gpuObjects.get(material);
    }
    if (!material) {
      return;
    }
    if (!material.baseTexture && !material.baseFactor) {
      // If material has no texture and no color, use missing texture
      console.log("Missing texture for material", material);
      material.baseTexture = { image: missingTextureBitmap, sampler: {} };
    } else if (!material.baseTexture && material.baseFactor) {
      // If material has no texture but has color, create a monochromatic texture
      let colorCanvas = this.createMonocolorBitmap(material.baseFactor);
      material.baseTexture = { image: colorCanvas, sampler: {} };
    }

    let baseTexture = this.prepareTexture(material.baseTexture);

    const materialUniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const materialBindGroup = this.device.createBindGroup({
      layout: this.materialBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: materialUniformBuffer } },
        { binding: 1, resource: baseTexture.gpuTexture.createView() },
        { binding: 2, resource: baseTexture.gpuSampler },
      ],
    });

    const gpuObjects = { materialUniformBuffer, materialBindGroup };
    this.gpuObjects.set(material, gpuObjects);
    return gpuObjects;
  }

  render(scene, camera) {
    if (Renderer.temp !== 0) {
      // Temporary fix: Teleport
      let matrix = camera.components[0].translation;
      matrix[0] += Renderer.teleportX;
      matrix[1] += Renderer.teleportY;
      matrix[2] += Renderer.teleportZ;

      camera.components[0].translation = matrix;
      Renderer.temp = 0;
    }

    if (
      this.depthTexture.width !== this.canvas.width ||
      this.depthTexture.height !== this.canvas.height
    ) {
      this.recreateDepthTexture();
    }

    const encoder = this.device.createCommandEncoder();
    this.renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: [1, 1, 1, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    this.renderPass.setPipeline(
      this.perFragment ? this.pipelinePerFragment : this.pipelinePerVertex
    );

    const cameraComponent = camera.getComponentOfType(Camera);
    const viewMatrix = getGlobalViewMatrix(camera);
    const projectionMatrix = getProjectionMatrix(camera);
    const cameraPosition = mat4.getTranslation(
      vec3.create(),
      getGlobalModelMatrix(camera)
    );
    const { cameraUniformBuffer, cameraBindGroup } =
      this.prepareCamera(cameraComponent);
    this.device.queue.writeBuffer(cameraUniformBuffer, 0, viewMatrix);
    this.device.queue.writeBuffer(cameraUniformBuffer, 64, projectionMatrix);
    this.device.queue.writeBuffer(cameraUniformBuffer, 128, cameraPosition);
    this.renderPass.setBindGroup(0, cameraBindGroup);

    const light = scene.find((node) => node.getComponentOfType(Light));
    const lightComponent = light.getComponentOfType(Light);
    const lightColor = vec3.scale(
      vec3.create(),
      lightComponent.color,
      lightComponent.intensity / 255
    );
    const lightPosition = mat4.getTranslation(
      vec3.create(),
      getGlobalModelMatrix(light)
    );
    const lightAttenuation = vec3.clone(lightComponent.attenuation);
    const { lightUniformBuffer, lightBindGroup } =
      this.prepareLight(lightComponent);
    this.device.queue.writeBuffer(lightUniformBuffer, 0, lightColor);
    this.device.queue.writeBuffer(lightUniformBuffer, 16, lightPosition);
    this.device.queue.writeBuffer(lightUniformBuffer, 32, lightAttenuation);
    this.renderPass.setBindGroup(1, lightBindGroup);

    this.renderNode(scene);

    this.renderPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  // renderNode(node, modelMatrix = mat4.create()) {
  //     const localMatrix = getLocalModelMatrix(node);
  //     modelMatrix = mat4.multiply(mat4.create(), modelMatrix, localMatrix);
  //     const normalMatrix = mat4.normalFromMat4(mat4.create(), modelMatrix);

  //     const { modelUniformBuffer, modelBindGroup } = this.prepareNode(node);
  //     this.device.queue.writeBuffer(modelUniformBuffer, 0, modelMatrix);
  //     this.device.queue.writeBuffer(modelUniformBuffer, 64, normalMatrix);
  //     this.renderPass.setBindGroup(2, modelBindGroup);

  //     for (const model of getModels(node)) {
  //         this.renderModel(model);
  //     }

  //     for (const child of node.children) {
  //         this.renderNode(child, modelMatrix);
  //     }
  // }
  renderNode(node, modelMatrix = mat4.create()) {
    if (node.draw === false) return; // Skip nodes with `draw` set to false

    const localMatrix = getLocalModelMatrix(node);
    modelMatrix = mat4.multiply(mat4.create(), modelMatrix, localMatrix);
    const normalMatrix = mat4.normalFromMat4(mat4.create(), modelMatrix);

    const { modelUniformBuffer, modelBindGroup } = this.prepareNode(node);
    this.device.queue.writeBuffer(
      modelUniformBuffer,
      0,
      new Float32Array(modelMatrix)
    );
    this.device.queue.writeBuffer(
      modelUniformBuffer,
      64,
      new Float32Array(normalMatrix)
    );
    this.renderPass.setBindGroup(2, modelBindGroup);

    for (const model of getModels(node)) {
      this.renderModel(model);
    }

    for (const child of node.children) {
      this.renderNode(child, modelMatrix);
    }
  }

  renderModel(model) {
    for (const primitive of model.primitives) {
      this.renderPrimitive(primitive);
    }
  }

  renderPrimitive(primitive) {
    const material = primitive.material;
    if (!material) return;

    const { materialUniformBuffer, materialBindGroup } =
      this.prepareMaterial(material);
    this.device.queue.writeBuffer(
      materialUniformBuffer,
      0,
      new Float32Array([
        ...material.baseFactor,
        material.diffuse,
        material.specular,
        material.shininess,
      ])
    );
    this.renderPass.setBindGroup(3, materialBindGroup);

    const { vertexBuffer, indexBuffer } = this.prepareMesh(
      primitive.mesh,
      vertexBufferLayout
    );
    this.renderPass.setVertexBuffer(0, vertexBuffer);
    this.renderPass.setIndexBuffer(indexBuffer, "uint32");

    this.renderPass.drawIndexed(primitive.mesh.indices.length);
  }
}

// Temporary fix: Teleport
Renderer.temp = 0;
Renderer.teleportX = 0;
Renderer.teleportY = 0;
Renderer.teleportZ = 0;