const THREE = window.THREE = require('three');
const dat = require('dat.gui');
const GLTFExporter = require('../lib/GLTFExporter');
const Tree = require('../lib/proctree');
const DEFAULT_CONFIG = require('./config');
const Viewer = require('./viewer');
const download = require('downloadjs');
const range = require('./range');

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

    this.initWaterParticles();
    this.addGUI();
    this.animate();
  }

  initWaterParticles() {
    const particles = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = []; // Array to hold velocities for each particle
    const colors = [];
    const color = new THREE.Color(0x77B5FE); // Soft blue for water

    for (let i = 0; i < particles; i++) {
        // Calculate initial positions and velocities for a spray effect
        const theta = Math.random() * Math.PI * 2; // Random angle around the spray axis
        const phi = Math.random() * Math.PI * 0.2; // Small spread in the vertical direction
        const r = Math.random() * 0.5; // Random radius from origin, within a narrow range
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi); // Main direction of spray should be along z-axis

        positions.push(x, y, z);
        velocities.push(10 * x, 10 * y, 10 * z); // Particles should move faster outward
        colors.push(color.r, color.g, color.b);
    }

    geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.addAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3)); // Store velocities in buffer
    geometry.addAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.02, // Smaller particles for a fine mist
        vertexColors: true,
        transparent: true,
        opacity: 0.5
    });

    this.particleSystem = new THREE.Points(geometry, material);
    this.viewer.scene.add(this.particleSystem);
}


  addGUI() {
    const gui = this.gui = new dat.GUI();
    // GUI code remains unchanged
  }
  createTree() {
    this.config.trunkLength = this.currentMaxRadius * 10;
    this.config.maxRadius = this.currentMaxRadius;
    this.config.levels = Math.max(Math.ceil(this.currentMaxRadius / 0.025), 1);
    this.config.climbRate = this.currentMaxRadius * 2.5;
    this.config.initialBranchLength = this.currentMaxRadius * 5;
    this.config.twigScale = this.currentMaxRadius * 2;
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

    if (this.currentMaxRadius < this.targetMaxRadius) {
      this.currentMaxRadius += (this.targetMaxRadius - this.currentMaxRadius) * 0.002; // Smooth interpolation
      this.currentMaxRadius = this.targetMaxRadius < this.currentMaxRadius ? this.targetMaxRadius : this.currentMaxRadius;
      this.createTree(); // Update the tree structure with new radius
    }


    this.updateParticles();
    this.viewer.render();
  }

  updateParticles() {
    const positions = this.particleSystem.geometry.attributes.position.array;
    const velocities = this.particleSystem.geometry.attributes.velocity.array;

    for (let i = 0; i < positions.length; i += 3) {
        // Update positions based on velocity
        positions[i] += velocities[i] * 0.01; // Scale movement to make it smooth
        positions[i + 1] += velocities[i + 1] * 0.01;
        positions[i + 2] += velocities[i + 2] * 0.01;

        // Optionally apply some resistance or gravity
        velocities[i + 2] -= 0.1; // Slow down in the z-direction to simulate gravity/drag

        // Reset particles if they move too far away
        if (positions[i + 2] < 0 || positions[i + 2] > 10) {
            positions[i] = positions[i + 1] = positions[i + 2] = 0; // Reset to origin
            velocities[i] = velocities[i + 1] = 10 * Math.random(); // Randomize new direction slightly
            velocities[i + 2] = 10 * Math.random(); // Mostly forward
        }
    }
    this.particleSystem.geometry.attributes.position.needsUpdate = true;
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
app.createTree();
