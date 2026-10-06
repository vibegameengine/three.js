import { Fn, If, instanceIndex, length, max, select, storage, uint, uniformArray, vec4 } from '../../nodes/TSL.js';
import { Vector4 } from '../../math/Vector4.js';
import { PRIMITIVE_VEC4S, PrimitiveLayout } from './GpuScene.js';
import IndirectStorageBufferAttribute from './IndirectStorageBufferAttribute.js';
import StorageBufferAttribute from './StorageBufferAttribute.js';

export const ARGS_WORDS = 5;
export const ARGS_STRIDE = ARGS_WORDS * 4;
const FRUSTUM_PLANES = 6;
const ALWAYS_DRAWN = - 1;

class RetainedCulling {

	constructor( gpuScene, count ) {

		this.count = count;
		this.args = new IndirectStorageBufferAttribute( new Uint32Array( Math.max( 1, count ) * ARGS_WORDS ), 1 );
		this.spheres = new StorageBufferAttribute( new Float32Array( Math.max( 1, count ) * 4 ), 4 );
		this.primitives = new StorageBufferAttribute( new Uint32Array( Math.max( 1, count ) ), 1 );
		this.instances = new StorageBufferAttribute( new Uint32Array( Math.max( 1, count ) ), 1 );
		this.planes = uniformArray( Array.from( { length: FRUSTUM_PLANES }, () => new Vector4() ), 'vec4' );
		this.gpuScene = gpuScene;
		this.recordsAttribute = gpuScene.records;
		this.node = this._kernel();

	}

	describe( index, { sphere, primitive, alwaysDrawn } ) {

		const at = index * 4;
		const spheres = this.spheres.array;
		spheres[ at ] = sphere.center.x;
		spheres[ at + 1 ] = sphere.center.y;
		spheres[ at + 2 ] = sphere.center.z;
		spheres[ at + 3 ] = alwaysDrawn ? ALWAYS_DRAWN : sphere.radius;
		this.primitives.array[ index ] = primitive;

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
		this.instances.array[ index ] = instances;

	}

	upload() {

		this.args.needsUpdate = true;
		this.spheres.needsUpdate = true;
		this.primitives.needsUpdate = true;
		this.instances.needsUpdate = true;

	}

	aim( frustum ) {

		const planes = this.planes.array;

		for ( let i = 0; i < FRUSTUM_PLANES; i ++ ) {

			const plane = frustum.planes[ i ];
			planes[ i ].set( plane.normal.x, plane.normal.y, plane.normal.z, plane.constant );

		}

	}

	get stale() {

		return this.recordsAttribute !== this.gpuScene.records;

	}

	_kernel() {

		const count = this.count;
		const args = storage( this.args, 'uint', this.args.count );
		const spheres = storage( this.spheres, 'vec4', this.spheres.count ).toReadOnly();
		const primitives = storage( this.primitives, 'uint', this.primitives.count ).toReadOnly();
		const records = storage( this.gpuScene.records, 'vec4', this.gpuScene.records.count ).toReadOnly();
		const instances = storage( this.instances, 'uint', this.instances.count ).toReadOnly();
		const planes = this.planes;

		return Fn( () => {

			const draw = instanceIndex;

			If( draw.lessThan( uint( count ) ), () => {

				const sphere = spheres.element( draw );
				const base = primitives.element( draw ).mul( uint( PRIMITIVE_VEC4S ) ).add( uint( PrimitiveLayout.world ) );
				const x = records.element( base ).xyz;
				const y = records.element( base.add( uint( 1 ) ) ).xyz;
				const z = records.element( base.add( uint( 2 ) ) ).xyz;
				const origin = records.element( base.add( uint( 3 ) ) ).xyz;
				const center = vec4( x.mul( sphere.x ).add( y.mul( sphere.y ) ).add( z.mul( sphere.z ) ).add( origin ), 1 ).toVar();
				const radius = sphere.w.mul( max( length( x ), length( y ), length( z ) ) ).toVar();
				const inside = sphere.w.lessThan( 0 ).toVar();

				If( inside.not(), () => {

					inside.assign( true );

					for ( let i = 0; i < FRUSTUM_PLANES; i ++ ) {

						const plane = planes.element( i );
						inside.assign( inside.and( plane.xyz.dot( center.xyz ).add( plane.w ).greaterThanEqual( radius.negate() ) ) );

					}

				} );

				args.element( draw.mul( uint( ARGS_WORDS ) ).add( uint( 1 ) ) ).assign( select( inside, instances.element( draw ), uint( 0 ) ) );

			} );

		} )().compute( Math.max( 1, count ) ).setName( 'Retained.Cull' );

	}

}

export default RetainedCulling;
