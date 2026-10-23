import { Fn, If, instanceIndex, length, max, select, storage, uint, uniform, uniformArray, vec4 } from '../../nodes/TSL.js';
import { Vector4 } from '../../math/Vector4.js';
import { PRIMITIVE_VEC4S, PrimitiveLayout } from './GpuScene.js';
import { FULL_SCREEN_SIZE_BAND } from './ScreenSizeLods.js';
import { aimLodEye, insideScreenSizeBand, lodEyeUniform } from './ScreenSizeBand.js';
import IndirectStorageBufferAttribute from './IndirectStorageBufferAttribute.js';
import StorageBufferAttribute from './StorageBufferAttribute.js';

export const ARGS_WORDS = 5;
export const ARGS_STRIDE = ARGS_WORDS * 4;
const FRUSTUM_PLANES = 6;
const ALWAYS_DRAWN = - 1;
const MIN_CAPACITY = 64;

function capacityFor( count ) {

	return Math.max( MIN_CAPACITY, 2 ** Math.ceil( Math.log2( Math.max( 1, count ) ) ) );

}

function grown( array, capacity, perSlot ) {

	const next = new array.constructor( capacity * perSlot );
	next.set( array );
	return next;

}

/**
 * Culls the draws of a retained pass on the GPU. Draws are addressed by their slot, the kernel
 * reads how many slots there are from a uniform and its buffers through nodes whose value is
 * swapped when they grow, so the kernel is built once for the life of the pass, as a culling
 * shader over a GPU scene is a global shader that never depends on what the scene holds.
 *
 * @private
 */
class RetainedCulling {

	constructor( gpuScene, count ) {

		this.capacity = capacityFor( count );
		this.count = uniform( count, 'uint' );
		this.args = new IndirectStorageBufferAttribute( new Uint32Array( this.capacity * ARGS_WORDS ), 1 );
		this.spheres = new StorageBufferAttribute( new Float32Array( this.capacity * 4 ), 4 );
		this.primitives = new StorageBufferAttribute( new Uint32Array( this.capacity ), 1 );
		this.instances = new StorageBufferAttribute( new Uint32Array( this.capacity ), 1 );
		this.bands = new StorageBufferAttribute( new Float32Array( this.capacity * 4 ), 4 );
		this.drawInstances = new Uint32Array( this.capacity );
		this.hidden = new Uint8Array( this.capacity );
		this.planes = uniformArray( Array.from( { length: FRUSTUM_PLANES }, () => new Vector4() ), 'vec4' );
		this.eye = lodEyeUniform();
		this.gpuScene = gpuScene;
		this.drawsKnown = false;
		this.recordsAttribute = gpuScene.records;
		this.argsNode = storage( this.args, 'uint', this.args.count );
		this.spheresNode = storage( this.spheres, 'vec4', this.spheres.count ).toReadOnly();
		this.primitivesNode = storage( this.primitives, 'uint', this.primitives.count ).toReadOnly();
		this.recordsNode = storage( gpuScene.records, 'vec4', gpuScene.records.count ).toReadOnly();
		this.instancesNode = storage( this.instances, 'uint', this.instances.count ).toReadOnly();
		this.bandsNode = storage( this.bands, 'vec4', this.bands.count ).toReadOnly();
		this.node = this._kernel();

	}

	reserve( count ) {

		this.count.value = count;

		if ( count <= this.capacity ) return false;

		const capacity = capacityFor( count );
		this.args = new IndirectStorageBufferAttribute( grown( this.args.array, capacity, ARGS_WORDS ), 1 );
		this.spheres = new StorageBufferAttribute( grown( this.spheres.array, capacity, 4 ), 4 );
		this.primitives = new StorageBufferAttribute( grown( this.primitives.array, capacity, 1 ), 1 );
		this.instances = new StorageBufferAttribute( grown( this.instances.array, capacity, 1 ), 1 );
		this.bands = new StorageBufferAttribute( grown( this.bands.array, capacity, 4 ), 4 );
		this.drawInstances = grown( this.drawInstances, capacity, 1 );
		this.hidden = grown( this.hidden, capacity, 1 );
		this.capacity = capacity;
		this.argsNode.value = this.args;
		this.spheresNode.value = this.spheres;
		this.primitivesNode.value = this.primitives;
		this.instancesNode.value = this.instances;
		this.bandsNode.value = this.bands;
		this.upload();
		return true;

	}

	followRecords() {

		this.recordsAttribute = this.gpuScene.records;
		this.recordsNode.value = this.gpuScene.records;

	}

	describe( index, { sphere, primitive, alwaysDrawn, band } ) {

		const at = index * 4;
		const spheres = this.spheres.array;
		spheres[ at ] = sphere.center.x;
		spheres[ at + 1 ] = sphere.center.y;
		spheres[ at + 2 ] = sphere.center.z;
		spheres[ at + 3 ] = alwaysDrawn ? ALWAYS_DRAWN : sphere.radius;
		this.primitives.array[ index ] = primitive;
		const drawnBand = band ?? FULL_SCREEN_SIZE_BAND;
		this.bands.array.set( [ drawnBand.min, drawnBand.max, sphere.radius, 0 ], at );

	}

	writeDraw( index, drawParams ) {

		const at = index * ARGS_WORDS;
		const args = this.args.array;
		const instances = drawParams === null ? 0 : drawParams.instanceCount;
		args[ at ] = drawParams === null ? 0 : drawParams.vertexCount;
		args[ at + 1 ] = instances;
		args[ at + 2 ] = drawParams === null ? 0 : drawParams.firstVertex;
		args[ at + 3 ] = 0;
		args[ at + 4 ] = 0;
		this.drawInstances[ index ] = instances;
		this.instances.array[ index ] = this.hidden[ index ] === 1 ? 0 : instances;

	}

	release( index ) {

		this.writeDraw( index, null );
		this.hidden[ index ] = 0;

	}

	hide( index, hidden ) {

		this.hidden[ index ] = hidden ? 1 : 0;
		this.instances.array[ index ] = hidden ? 0 : this.drawInstances[ index ];
		this.instances.addUpdateRange( index, 1 );
		this.instances.needsUpdate = true;

	}

	upload() {

		this.args.needsUpdate = true;
		this.spheres.needsUpdate = true;
		this.primitives.needsUpdate = true;
		this.instances.needsUpdate = true;
		this.bands.needsUpdate = true;

	}

	aim( frustum, camera ) {

		const planes = this.planes.array;

		for ( let i = 0; i < FRUSTUM_PLANES; i ++ ) {

			const plane = frustum.planes[ i ];
			planes[ i ].set( plane.normal.x, plane.normal.y, plane.normal.z, plane.constant );

		}

		aimLodEye( this.eye, camera );

	}

	get stale() {

		return this.recordsAttribute !== this.gpuScene.records;

	}

	_kernel() {

		const count = this.count;
		const args = this.argsNode;
		const spheres = this.spheresNode;
		const primitives = this.primitivesNode;
		const records = this.recordsNode;
		const instances = this.instancesNode;
		const bands = this.bandsNode;
		const planes = this.planes;
		const eye = this.eye;

		return Fn( () => {

			const draw = instanceIndex;

			If( draw.lessThan( count ), () => {

				const sphere = spheres.element( draw );
				const base = primitives.element( draw ).mul( uint( PRIMITIVE_VEC4S ) ).add( uint( PrimitiveLayout.world ) );
				const x = records.element( base ).xyz;
				const y = records.element( base.add( uint( 1 ) ) ).xyz;
				const z = records.element( base.add( uint( 2 ) ) ).xyz;
				const origin = records.element( base.add( uint( 3 ) ) ).xyz;
				const center = vec4( x.mul( sphere.x ).add( y.mul( sphere.y ) ).add( z.mul( sphere.z ) ).add( origin ), 1 ).toVar();
				const maxScale = max( length( x ), length( y ), length( z ) ).toVar();
				const radius = sphere.w.mul( maxScale ).toVar();
				const inside = sphere.w.lessThan( 0 ).toVar();

				If( inside.not(), () => {

					inside.assign( true );

					for ( let i = 0; i < FRUSTUM_PLANES; i ++ ) {

						const plane = planes.element( i );
						inside.assign( inside.and( plane.xyz.dot( center.xyz ).add( plane.w ).greaterThanEqual( radius.negate() ) ) );

					}

				} );

				const band = bands.element( draw ).toVar();
				const inBand = insideScreenSizeBand( { worldCenter: center.xyz, worldRadius: band.z.mul( maxScale ), band, eye } );

				args.element( draw.mul( uint( ARGS_WORDS ) ).add( uint( 1 ) ) ).assign( select( inside.and( inBand ), instances.element( draw ), uint( 0 ) ) );

			} );

		} )().compute( 1 ).setName( 'Retained.Cull' );

	}

}

export default RetainedCulling;
