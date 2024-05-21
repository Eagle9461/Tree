const THREE = window.THREE = require('three');
const FBXLoader = require('three-fbx-loader');
const dat = require('dat.gui');
const GLTFExporter = require('../lib/GLTFExporter');
const Tree = require('../lib/proctree');
const DEFAULT_CONFIG = require('./config');
const Viewer = require('./viewer');
const download = require('downloadjs');

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

    this.addGUI();
    this.initGround();
    this.plantSeed();
  }

  plantSeed() {
    const seedGeometry = new THREE.SphereGeometry(0.1, 16, 16); // Small sphere to represent the seed
    const seedMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 }); // Dark brown color
    this.seed = new THREE.Mesh(seedGeometry, seedMaterial);

    // Position the seed above the ground where it will be "planted"
    this.seed.position.set(0, 3, 0); // Adjust Y to be above the ground
    this.viewer.scene.add(this.seed);

    this.seedPlanted = false;
    // const seedStartHeight = 5; // Start height above the ground
    this.seedEndHeight = -3; // Slightly below the ground surface to simulate "planting"
  }

  initGround() {
    const geometry = new THREE.PlaneGeometry(50, 50); // You can adjust the size as needed
    const material = new THREE.MeshStandardMaterial({
      color: 0x006600, // A dark green, resembling grass
      roughness: 2,
      metalness: 0.2
    });

    const textureLoader = new THREE.TextureLoader();
    material.map = textureLoader.load('../assets/ground.jpeg');
    // material.bumpScale = 2;
    // material.displacementScale = 0.2;

    this.ground = new THREE.Mesh(geometry, material);
    this.ground.rotation.x = -Math.PI / 2; // Rotate the plane to lie flat
    this.ground.position.y = -3; // Adjust the Y position according to where you want the ground level to be
    this.ground.receiveShadow = true;

    this.viewer.scene.add(this.ground);
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
      treeFolder.add(this.config, 'levels').min(0).max(10),
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
    this.config.trunkLength = this.currentMaxRadius * 10;
    this.config.maxRadius = this.currentMaxRadius;
    this.config.levels = Math.max(Math.ceil(this.currentMaxRadius / 0.025), 1);
    this.config.climbRate = this.currentMaxRadius * 2.5;
    this.config.initalBranchLength = this.currentMaxRadius * 6;
    this.config.twigScale = this.currentMaxRadius * 2.5;
    const tree = new Tree(this.config);

    const treeGeometry = new THREE.BufferGeometry();
    treeGeometry.addAttribute('position', createFloatAttribute(tree.verts, 3));
    treeGeometry.addAttribute('normal', normalizeAttribute(createFloatAttribute(tree.normals, 3)));
    treeGeometry.addAttribute('uv', createFloatAttribute(tree.UV, 2));
    treeGeometry.setIndex(createIntAttribute(tree.faces, 1));

    const twigGeometry = new THREE.BufferGeometry();
    twigGeometry.addAttribute('position', createFloatAttribute(tree.vertsTwig, 3));
    twigGeometry.addAttribute('normal', normalizeAttribute(createFloatAttribute(tree.normalsTwig, 3)));
    twigGeometry.addAttribute('uv', createFloatAttribute(tree.uvsTwig, 2));
    twigGeometry.setIndex(createIntAttribute(tree.facesTwig, 1));

    const treeGroup = new THREE.Group();
    treeGroup.add(new THREE.Mesh(treeGeometry, this.treeMaterial));
    treeGroup.add(new THREE.Mesh(twigGeometry, this.twigMaterial));

    this.viewer.setTree(treeGroup);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.seedPlanted) {
      this.seed.position.y -= 0.02; // Move the seed down each frame
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