const THREE = window.THREE = require('three');
const FBXLoader = require('three-fbx-loader');
const {OBJLoader, MTLLoader} = require('three-obj-mtl-loader');
const dat = require('dat.gui');
const GLTFExporter = require('../lib/GLTFExporter');
const Tree = require('../lib/proctree');
const DEFAULT_CONFIG = require('./config');
const Viewer = require('./viewer');
const download = require('downloadjs');

const vert = `

varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;
uniform float iTime;

void main() {
    vUv = uv;
    cloudUV = uv;
    vColor = color;
    vec3 cpos = position;

    float waveSize = 7.0;
    float tipDistance = 0.3;
    float centerDistance = 0.1;

    if (color.x > 0.6) {
        cpos.x += sin((iTime / 500.0) + (uv.x * waveSize)) * tipDistance;
    } else if (color.x > 0.0) {
        cpos.x += sin((iTime / 500.0) + (uv.x * waveSize)) * centerDistance;
    }

    float diff = position.x - cpos.x;
    cloudUV.x += iTime / 20000.0;
    cloudUV.y += iTime / 10000.0;

    vec4 worldPosition = vec4(cpos, 1.0);
    vec4 mvPosition = projectionMatrix * modelViewMatrix * vec4(cpos, 1.0);
    gl_Position = mvPosition;
}
`;

const frag = `
uniform sampler2D texture1;
uniform sampler2D textures[4];

varying vec2 vUv;
varying vec2 cloudUV;
varying vec3 vColor;

void main() {
    float contrast = 1.5;
    float brightness = 0.01;
    vec3 texColor = texture2D(textures[0], vUv).rgb * contrast;
    texColor += vec3(brightness, brightness, brightness);
    texColor = mix(texColor, texture2D(textures[1], cloudUV).rgb, -2.1);
    gl_FragColor.rgb = texColor;
    gl_FragColor.a = 1.0;
}
`;

// Parameters
const PLANE_SIZE = 30;
const BLADE_COUNT = 100000;
const BLADE_WIDTH = 0.05;
const BLADE_HEIGHT = 0.2;
const BLADE_HEIGHT_VARIATION = 0.4;

class App {
  constructor(el) {
    this.age = 1;
    this.config = Object.assign({}, DEFAULT_CONFIG);
    this.viewer = new Viewer(el);

    this.textureLoader = new THREE.TextureLoader();
    this.treeMaterial = new THREE.MeshStandardMaterial({
      color: this.config.treeColor,
      roughness: 1.0,
      metalness: 0.0
    });
    this.twigMaterial = new THREE.MeshStandardMaterial({
      color: this.config.twigColor,
      roughness: 1.0,
      metalness: 0.0,
      map: this.textureLoader.load('assets/twig-1.png'),
      alphaTest: 0.9
    });

    this.currentTrunkLength = this.config.trunkLength;
    this.targetTrunkLength = this.config.targetTrunkLength;
    this.currentMaxRadius = this.config.maxRadius;
    this.targetMaxRadius = this.config.targetMaxRadius;

    // Grass Texture
    this.grassTexture = new THREE.TextureLoader().load('assets/grass.jpg');
    this.cloudTexture = new THREE.TextureLoader().load('assets/cloud.jpg');
    this.cloudTexture.wrapS = this.cloudTexture.wrapT = THREE.RepeatWrapping;

    this.timeUniform = { type: 'f', value: 0.0 };
    this.grassUniforms = {
      textures: { value: [this.grassTexture, this.cloudTexture] },
      iTime: this.timeUniform
    };

    this.grassMaterial = new THREE.ShaderMaterial({
      uniforms: this.grassUniforms,
      vertexShader: vert,
      fragmentShader: frag,
      vertexColors: true,
      side: THREE.DoubleSide
    });

    this.addGUI();
    this.initGround();
    this.plantSeed();
  }

  convertRange (val, oldMin, oldMax, newMin, newMax) {
    return (((val - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
  }
  
  generateField () {
    const positions = [];
    const uvs = [];
    const indices = [];
    const colors = [];

    for (let i = 0; i < BLADE_COUNT; i++) {
      const VERTEX_COUNT = 5;
      const surfaceMin = PLANE_SIZE / 2 * -1;
      const surfaceMax = PLANE_SIZE / 2;
      const radius = PLANE_SIZE / 2;

      const r = radius * Math.sqrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);

      const pos = new THREE.Vector3(x, -3, y);

      const uv = [this.convertRange(pos.x, surfaceMin, surfaceMax, 0, 1), this.convertRange(pos.z, surfaceMin, surfaceMax, 0, 1)];

      const blade = this.generateBlade(pos, i * VERTEX_COUNT, uv);
      blade.verts.forEach(vert => {
        positions.push(...vert.pos);
        uvs.push(...vert.uv);
        colors.push(...vert.color);
      });
      blade.indices.forEach(indice => indices.push(indice));
    }

    const geom = new THREE.BufferGeometry();
    geom.addAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.addAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geom.addAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    geom.computeFaceNormals();

    const mesh = new THREE.Mesh(geom, this.grassMaterial);
    this.viewer.scene.add(mesh);
  }

  generateBlade (center, vArrOffset, uv) {
    const MID_WIDTH = BLADE_WIDTH * 0.5;
    const TIP_OFFSET = 0.1;
    const height = BLADE_HEIGHT + (Math.random() * BLADE_HEIGHT_VARIATION);

    const yaw = Math.random() * Math.PI * 2;
    const yawUnitVec = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const tipBend = Math.random() * Math.PI * 2;
    const tipBendUnitVec = new THREE.Vector3(Math.sin(tipBend), 0, -Math.cos(tipBend));

    // Find the Bottom Left, Bottom Right, Top Left, Top right, Top Center vertex positions
    const bl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((BLADE_WIDTH / 2) * 1));
    const br = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((BLADE_WIDTH / 2) * -1));
    const tl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * 1));
    const tr = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * -1));
    const tc = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(tipBendUnitVec).multiplyScalar(TIP_OFFSET));

    tl.y += height / 2;
    tr.y += height / 2;
    tc.y += height;

    // Vertex Colors
    const black = [0, 0, 0];
    const gray = [0.5, 0.5, 0.5];
    const white = [1.0, 1.0, 1.0];

    const verts = [
      { pos: bl.toArray(), uv: uv, color: black },
      { pos: br.toArray(), uv: uv, color: black },
      { pos: tr.toArray(), uv: uv, color: gray },
      { pos: tl.toArray(), uv: uv, color: gray },
      { pos: tc.toArray(), uv: uv, color: white }
    ];

    const indices = [
      vArrOffset,
      vArrOffset + 1,
      vArrOffset + 2,
      vArrOffset + 2,
      vArrOffset + 4,
      vArrOffset + 3,
      vArrOffset + 3,
      vArrOffset,
      vArrOffset + 2
    ];

    return { verts, indices };
  }


  plantSeed() {
    const fbxLoader = new FBXLoader();
    fbxLoader.load('../assets/seed/acorn.fbx', (object) => {
      this.seed = object;
      this.seed.scale.set(0.001, 0.001, 0.001); // Adjust the scale if necessary
      this.seed.position.set(0, 3, 0);
      this.viewer.scene.add(this.seed);
      this.seed.traverse((child) => {
        if (child.isMesh) {
          child.material.color.set(0x2f1d12); // Light blue color
          child.material.needsUpdate = true;
        }
      });
      this.seed.rotation.z = Math.PI / 2;
      this.seedEndHeight = -3;
      this.seedPlanted = false;
    });
  }
  
  initGround() {
    const geometry = new THREE.CircleGeometry(15) //PlaneGeometry(35, 35); // You can adjust the size as needed
    const material = new THREE.MeshStandardMaterial({
      color: 0x006600, // A dark green, resembling grass
      roughness: 2,
      metalness: 0.2
    });

    const textureLoader = new THREE.TextureLoader();
    material.map = textureLoader.load('../assets/grass.jpg');
    // material.bumpScale = 2;
    // material.displacementScale = 0.2;

    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2; // Rotate the plane to lie flat
    this.ground.position.y = -3; // Adjust the Y position according to where you want the ground level to be
    this.ground.receiveShadow = true;

    this.viewer.scene.add(this.ground);

    this.generateField();
  }

  initWaterParticles() {
    const particles = 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = []; // Array to hold velocities for each particle
    const colors = [];
    const color = new THREE.Color(0x77B5FE); // Soft blue for water

    for (let i = 0; i < particles; i++) {
      // Calculate initial positions and velocities for a spray effect
      const theta = Math.random() * Math.PI * 0.6; // Random angle around the spray axis
      const phi = Math.random() * Math.PI * 0.2; // Small spread in the vertical direction
      const r = Math.random() * 0.5; // Random radius from origin, within a narrow range
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi); // Main direction of spray should be along z-axis

      positions.push(0, 0, -1.6);
      velocities.push(0, Math.abs(y / 5), Math.abs(10 * z)); // Particles should move faster outward
      colors.push(color.r, color.g, color.b);
    }

    geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.addAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3)); // Store velocities in buffer
    geometry.addAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08, // Smaller particles for a fine mist
      vertexColors: true,
      transparent: true,
      opacity: 0.5
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.viewer.scene.add(this.particleSystem);
  }

  initWaterCan() {
    const fbxLoader = new FBXLoader();
    fbxLoader.load('../assets/Watering Can.fbx', (object) => {
      this.waterCan = object;
      this.waterCan.scale.set(0.02, 0.02, 0.02); // Adjust the scale if necessary
      this.waterCan.position.set(0, -0.07, -2.15); // Position it in your scene
      this.viewer.scene.add(this.waterCan);
      this.waterCan.traverse((child) => {
        if (child.isMesh) {
          child.material.color.set(0xADD8E6); // Light blue color
          child.material.needsUpdate = true;
        }
      });
      this.waterCan.rotation.y = Math.PI / 2;
      this.waterCan.rotation.z = Math.PI / 5;

      // Optionally, position the particle system at the spout of the water can
    });
  }

  addGUI() {
    const gui = this.gui = new dat.GUI();
    // GUI code remains unchanged.
    const treeFolder = gui.addFolder('tree');
    const branchFolder = gui.addFolder('branching');
    const trunkFolder = gui.addFolder('trunk');

    const ctrls = [
      // Tree
      treeFolder.add(this.config, 'seed').min(1).max(1000),
      // treeFolder.add(this.config, 'segments').min(6).max(20), no effect
      treeFolder.add(this.config, 'levels').min(0).max(7),
      // treeFolder.add(this.config, 'vMultiplier').min(0.01).max(10), no textures
      treeFolder.add(this.config, 'twigScale').min(0).max(1),

      // Branching
      branchFolder.add(this.config, 'initalBranchLength').min(0.1).max(1),
      branchFolder.add(this.config, 'lengthFalloffFactor').min(0.5).max(1),
      branchFolder.add(this.config, 'lengthFalloffPower').min(0.1).max(1.5),
      branchFolder.add(this.config, 'clumpMax').min(0).max(1),
      branchFolder.add(this.config, 'clumpMin').min(0).max(1),
      branchFolder.add(this.config, 'branchFactor').min(2).max(4),
      branchFolder.add(this.config, 'dropAmount').min(-1).max(1),
      branchFolder.add(this.config, 'growAmount').min(-0.5).max(1),
      branchFolder.add(this.config, 'sweepAmount').min(-1).max(1),

      // Trunk
      trunkFolder.add(this.config, 'maxRadius').min(0.05).max(1.0),
      trunkFolder.add(this.config, 'climbRate').min(0.05).max(1.0),
      trunkFolder.add(this.config, 'trunkKink').min(0.0).max(0.5),
      trunkFolder.add(this.config, 'treeSteps').min(0).max(35).step(1),
      trunkFolder.add(this.config, 'taperRate').min(0.7).max(1.0),
      trunkFolder.add(this.config, 'radiusFalloffRate').min(0.5).max(0.8),
      trunkFolder.add(this.config, 'twistRate').min(0.0).max(10.0),
      trunkFolder.add(this.config, 'trunkLength').min(0.1).max(5.0),
    ];

    ctrls.forEach((ctrl) => {
      ctrl.onChange(() => this.createTree());
      ctrl.listen();
    });
  }
  createTree() {
    this.config.trunkLength = this.currentMaxRadius * 8;
    this.config.maxRadius = this.currentMaxRadius;
    this.config.levels = Math.min(Math.ceil(this.currentMaxRadius / 0.025), 7);
    this.config.climbRate = this.currentMaxRadius * 2;
    this.config.initalBranchLength = this.currentMaxRadius * 3;
    this.config.twigScale = this.currentMaxRadius * 2;
    if(this.tree) delete this.tree;
    this.tree = new Tree(this.config);

    if(this.treeGeometry) delete this.treeGeometry;
    this.treeGeometry = new THREE.BufferGeometry();
    this.treeGeometry.addAttribute('position', createFloatAttribute(this.tree.verts, 3));
    this.treeGeometry.addAttribute('normal', normalizeAttribute(createFloatAttribute(this.tree.normals, 3)));
    this.treeGeometry.addAttribute('uv', createFloatAttribute(this.tree.UV, 2));
    this.treeGeometry.setIndex(createIntAttribute(this.tree.faces, 1));

    if(this.twigGeometry) delete this.twigGeometry;
    this.twigGeometry = new THREE.BufferGeometry();
    this.twigGeometry.addAttribute('position', createFloatAttribute(this.tree.vertsTwig, 3));
    this.twigGeometry.addAttribute('normal', normalizeAttribute(createFloatAttribute(this.tree.normalsTwig, 3)));
    this.twigGeometry.addAttribute('uv', createFloatAttribute(this.tree.uvsTwig, 2));
    this.twigGeometry.setIndex(createIntAttribute(this.tree.facesTwig, 1));

    if(this.treeGroup) delete this.treeGroup;
    this.treeGroup = new THREE.Group();
    if(this.mesh1) delete this.mesh1;
    if(this.mesh2) delete this.mesh2;
    this.mesh1 = new THREE.Mesh(this.treeGeometry, this.treeMaterial);
    this.mesh2 = new THREE.Mesh(this.twigGeometry, this.twigMaterial);
    this.treeGroup.add(this.mesh1);
    this.treeGroup.add(this.mesh2);

    this.viewer.setTree(this.treeGroup);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.seedPlanted) {
      this.seed.position.y -= 0.07; // Move the seed down each frame
      if (this.seed.position.y <= this.seedEndHeight) {
        this.seed.position.y = this.seedEndHeight;
        this.seedPlanted = true;
      }
    } else {
      if (this.currentMaxRadius < this.targetMaxRadius) {
        this.currentMaxRadius += (this.targetMaxRadius - this.currentMaxRadius) * 0.002; // Smooth interpolation
        this.currentMaxRadius = this.targetMaxRadius < this.currentMaxRadius ? this.targetMaxRadius : this.currentMaxRadius;
        this.createTree(); // Update the tree structure with new radius
      }
      this.updateParticles(this.particleSystem);
    }
    this.viewer.render();
  }

  updateParticles(system) {
    const positions = system.geometry.attributes.position.array;
    const velocities = system.geometry.attributes.velocity.array;

    for (let i = 0; i < positions.length; i += 3) {
      velocities[i + 2] = velocities[i + 2] - 0.02;

      if (velocities[i + 2] < 0) {
        positions[i + 2] += 0.05;
        positions[i + 1] += velocities[i + 1];
        velocities[i + 1] = velocities[i + 1] - 0.01;
      }
      if (positions[i + 1] < -3) {
        const theta = Math.random() * Math.PI * 0.6; // Random angle around the spray axis
        const phi = Math.random() * Math.PI * 0.2; // Small spread in the vertical direction
        const r = Math.random() * 0.5;
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi); // Main direction of spray should be along z-axis

        positions[i] = positions[i + 1] = 0;
        positions[i + 2] = -1.6;
        velocities[i + 1] = Math.abs(y / 5);
        velocities[i + 2] = Math.abs(10 * z);
      }
    }
    system.geometry.attributes.position.needsUpdate = true;
  }

  exportGLTF() {
    const exporter = new GLTFExporter();
    exporter.parse(this.viewer.getTree(), (buffer) => {
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      download(blob, 'tree.glb', 'application/octet-stream');
    }, { binary: true });
  }

  resetDefaults() {
    Object.assign(this.config, DEFAULT_CONFIG);
    this.createTree();
  }
}

function createFloatAttribute(array, itemSize) {
  const typedArray = new Float32Array(Tree.flattenArray(array));
  return new THREE.BufferAttribute(typedArray, itemSize);
}

function createIntAttribute(array, itemSize) {
  const typedArray = new Uint16Array(Tree.flattenArray(array));
  return new THREE.BufferAttribute(typedArray, itemSize);
}

function normalizeAttribute(attribute) {
  var v = new THREE.Vector3();
  for (var i = 0; i < attribute.count; i++) {
    v.set(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
    v.normalize();
    attribute.setXYZ(i, v.x, v.y, v.z);
  }
  return attribute;
}

const app = new App(document.querySelector('#container'));
app.initWaterCan();
document.querySelector('#plantButton').addEventListener('click', function () {
  console.log('Planting seed...');
  app.initWaterParticles();
  app.animate(); // Assume this function triggers the planting animation in Three.js
});