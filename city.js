import * as THREE from 'three/webgpu';

const params = new URLSearchParams(location.search);
const FORK = params.get('three') === 'fork';
const BUILDINGS_PER_SIDE = Number(params.get('blocks') ?? 70);
const CARS = Number(params.get('cars') ?? 3000);
const PALETTE = 256;
const BLOCK = 12;
const STREET = 4;
const CITY = BUILDINGS_PER_SIDE * BLOCK;

function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = ( state + 0x6D2B79F5 ) >>> 0;
		let t = state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}

function palette(next) {
	return Array.from( { length: PALETTE }, () => new THREE.MeshStandardNodeMaterial( {
		color: new THREE.Color().setHSL( 0.05 + next() * 0.12, 0.1 + next() * 0.25, 0.25 + next() * 0.45 ),
		roughness: 0.4 + next() * 0.55,
		metalness: next() < 0.15 ? 0.8 : 0,
	} ) );
}

function buildCity(scene) {
	const next = random( 182 );
	const materials = palette( next );
	const box = new THREE.BoxGeometry( 1, 1, 1 ).translate( 0, 0.5, 0 );
	const roofUnit = new THREE.CylinderGeometry( 0.5, 0.5, 1, 12 ).translate( 0, 0.5, 0 );
	let meshes = 0;
	for ( let x = 0; x < BUILDINGS_PER_SIDE; x ++ ) for ( let z = 0; z < BUILDINGS_PER_SIDE; z ++ ) {
		const size = BLOCK - STREET;
		const height = 4 + next() ** 3 * 60 * ( 1 - Math.hypot( x - BUILDINGS_PER_SIDE / 2, z - BUILDINGS_PER_SIDE / 2 ) / BUILDINGS_PER_SIDE );
		const building = new THREE.Mesh( box, materials[ Math.floor( next() * PALETTE ) ] );
		building.position.set( x * BLOCK - CITY / 2, 0, z * BLOCK - CITY / 2 );
		building.scale.set( size, Math.max( 3, height ), size );
		scene.add( building );
		const roof = new THREE.Mesh( roofUnit, materials[ Math.floor( next() * PALETTE ) ] );
		roof.position.set( building.position.x + ( next() - 0.5 ) * size * 0.6, building.scale.y, building.position.z + ( next() - 0.5 ) * size * 0.6 );
		roof.scale.set( 1.5, 1 + next() * 2, 1.5 );
		scene.add( roof );
		meshes += 2;
	}
	const ground = new THREE.Mesh( new THREE.PlaneGeometry( CITY * 1.2, CITY * 1.2 ).rotateX( - Math.PI / 2 ), new THREE.MeshStandardNodeMaterial( { color: 0x2a2c30, roughness: 0.95 } ) );
	ground.position.set( - BLOCK / 2, 0, - BLOCK / 2 );
	scene.add( ground );
	const cars = [];
	const carBody = new THREE.BoxGeometry( 1.8, 1.2, 4 ).translate( 0, 0.6, 0 );
	for ( let at = 0; at < CARS; at ++ ) {
		const car = new THREE.Mesh( carBody, materials[ Math.floor( next() * PALETTE ) ] );
		const alongX = next() < 0.5;
		const lane = Math.floor( next() * BUILDINGS_PER_SIDE ) * BLOCK - CITY / 2 - BLOCK / 2;
		car.userData = { alongX, lane, offset: next() * CITY, speed: ( 8 + next() * 10 ) * ( next() < 0.5 ? - 1 : 1 ) };
		if ( alongX ) car.rotation.y = Math.PI / 2;
		scene.add( car );
		cars.push( car );
	}
	return { cars, meshes: meshes + CARS + 1 };
}

function driveCars(cars, seconds) {
	for ( const car of cars ) {
		const { alongX, lane, offset, speed } = car.userData;
		const along = ( ( offset + speed * seconds ) % CITY + CITY ) % CITY - CITY / 2;
		if ( alongX ) car.position.set( along, 0, lane );
		else car.position.set( lane, 0, along );
	}
}

const renderer = new THREE.WebGPURenderer( { antialias: false } );
renderer.setPixelRatio( 1 );
renderer.setSize( innerWidth, innerHeight );
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x8fa3b8 );
scene.fog = new THREE.Fog( 0x8fa3b8, CITY * 0.25, CITY * 0.9 );
scene.add( new THREE.HemisphereLight( 0xcfe0ff, 0x3a3226, 1.2 ) );
const sun = new THREE.DirectionalLight( 0xfff1dc, 2.4 );
sun.position.set( 300, 500, 200 );
scene.add( sun );
const camera = new THREE.PerspectiveCamera( 55, innerWidth / innerHeight, 1, CITY * 2 );
const { cars, meshes } = buildCity( scene );

let retained = null;
if ( FORK ) {
	renderer.gpuScene = new THREE.GpuScene();
	retained = renderer.createRetainedPass();
}

addEventListener( 'resize', () => {
	renderer.setSize( innerWidth, innerHeight );
	camera.aspect = innerWidth / innerHeight;
	camera.updateProjectionMatrix();
} );

let running = params.get('paused') !== '1';
let clock = 0;
let last = performance.now();
let window_ = { frames: 0, started: performance.now(), renderMs: 0 };

function report() {
	const elapsed = performance.now() - window_.started;
	parent.postMessage( { pane: FORK ? 'fork' : 'stock', meshes, frames: window_.frames, fps: ( window_.frames * 1000 ) / Math.max( 1, elapsed ), renderMs: window_.renderMs / Math.max( 1, window_.frames ) }, '*' );
}

function frame(now) {
	if ( ! running ) return;
	const dt = Math.min( 0.1, ( now - last ) / 1000 );
	last = now;
	clock += dt;
	driveCars( cars, clock );
	const angle = clock * 0.05;
	camera.position.set( Math.cos( angle ) * CITY * 0.45, CITY * 0.18, Math.sin( angle ) * CITY * 0.45 );
	camera.lookAt( 0, 0, 0 );
	const started = performance.now();
	if ( FORK ) renderer.renderRetained( scene, camera, retained );
	else renderer.render( scene, camera );
	window_.renderMs += performance.now() - started;
	window_.frames ++;
	requestAnimationFrame( frame );
}

addEventListener( 'message', ( event ) => {
	if ( event.data?.run === true && ! running ) {
		running = true;
		last = performance.now();
		window_ = { frames: 0, started: performance.now(), renderMs: 0 };
		requestAnimationFrame( frame );
	} else if ( event.data?.run === false && running ) {
		report();
		running = false;
	} else if ( event.data?.report ) report();
} );

parent.postMessage( { pane: FORK ? 'fork' : 'stock', ready: true, meshes }, '*' );
requestAnimationFrame( frame );
