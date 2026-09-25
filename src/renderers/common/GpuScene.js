import { InstancedBufferAttribute } from '../../core/InstancedBufferAttribute.js';
import { Matrix3 } from '../../math/Matrix3.js';
import StorageBufferAttribute from './StorageBufferAttribute.js';

export const PrimitiveLayout = Object.freeze( { world: 0, previousWorld: 4, normal: 8 } );
export const PRIMITIVE_VEC4S = 12;
export const PRIMITIVE_FLOATS = PRIMITIVE_VEC4S * 4;

const WORLD_OFFSET = PrimitiveLayout.world * 4;
const PREVIOUS_OFFSET = PrimitiveLayout.previousWorld * 4;
const NORMAL_OFFSET = PrimitiveLayout.normal * 4;
const _normalMatrix = /*@__PURE__*/ new Matrix3();

export const gpuScenePrimitiveTemplate = /*@__PURE__*/ new InstancedBufferAttribute( new Uint32Array( 1 ), 1 );
gpuScenePrimitiveTemplate.isGpuScenePrimitiveTemplate = true;

class GpuScene {

	constructor( capacity = 1024 ) {

		this.capacity = capacity;
		this.records = new StorageBufferAttribute( new Float32Array( capacity * PRIMITIVE_FLOATS ), 4 );
		this.recordsNode = null;
		this.primitives = new WeakMap();
		this.freeIds = [];
		this.nextId = 0;
		this.dirtyFirst = Infinity;
		this.dirtyLast = - 1;
		this.grown = false;
		this.releaser = new FinalizationRegistry( ( id ) => this.release( id ) );

	}

	primitiveAttribute( object ) {

		return this.primitiveOf( object ).attribute;

	}

	sync( object, frameId ) {

		const primitive = this.primitiveOf( object );
		const base = primitive.id * PRIMITIVE_FLOATS;
		const array = this.records.array;

		if ( primitive.frame !== frameId ) {

			primitive.frame = frameId;

			if ( primitive.settled === false ) {

				array.copyWithin( base + PREVIOUS_OFFSET, base + WORLD_OFFSET, base + WORLD_OFFSET + 16 );
				primitive.settled = true;
				this.markDirty( primitive.id );

			}

		}

		if ( sameMatrix( array, base + WORLD_OFFSET, object.matrixWorld.elements ) === false ) {

			this.writeCurrent( base, object.matrixWorld );
			primitive.settled = false;
			this.markDirty( primitive.id );

		}

	}

	syncRenderList( renderList, frameId ) {

		for ( const item of renderList.opaque ) this.sync( item.object, frameId );
		for ( const item of renderList.transparent ) this.sync( item.object, frameId );
		for ( const item of renderList.transparentDoublePass ) this.sync( item.object, frameId );

	}

	flush() {

		if ( this.dirtyLast < 0 ) return false;

		if ( this.grown === true ) {

			this.records.clearUpdateRanges();
			this.grown = false;

		} else {

			this.records.addUpdateRange( this.dirtyFirst * PRIMITIVE_FLOATS, ( this.dirtyLast - this.dirtyFirst + 1 ) * PRIMITIVE_FLOATS );

		}

		this.records.needsUpdate = true;
		this.dirtyFirst = Infinity;
		this.dirtyLast = - 1;
		return true;

	}

	release( id ) {

		this.freeIds.push( id );

	}

	primitiveOf( object ) {

		let primitive = this.primitives.get( object );

		if ( primitive === undefined ) {

			const id = this.allocate();
			const attribute = new InstancedBufferAttribute( new Uint32Array( [ id ] ), 1 );
			attribute.isGpuScenePrimitive = true;
			primitive = { id, attribute, frame: - 1, settled: true };
			this.primitives.set( object, primitive );
			this.releaser.register( object, id );

			const base = id * PRIMITIVE_FLOATS;
			this.writeCurrent( base, object.matrixWorld );
			this.records.array.copyWithin( base + PREVIOUS_OFFSET, base + WORLD_OFFSET, base + WORLD_OFFSET + 16 );
			this.markDirty( id );

		}

		return primitive;

	}

	allocate() {

		if ( this.freeIds.length > 0 ) return this.freeIds.pop();
		if ( this.nextId === this.capacity ) this.grow( this.capacity * 2 );
		return this.nextId ++;

	}

	grow( capacity ) {

		const array = new Float32Array( capacity * PRIMITIVE_FLOATS );
		array.set( this.records.array );
		this.capacity = capacity;
		this.records = new StorageBufferAttribute( array, 4 );
		this.grown = true;

		if ( this.recordsNode !== null ) this.recordsNode.value = this.records;

	}

	writeCurrent( base, matrixWorld ) {

		const array = this.records.array;
		array.set( matrixWorld.elements, base + WORLD_OFFSET );

		const normal = _normalMatrix.getNormalMatrix( matrixWorld ).elements;

		for ( let column = 0; column < 3; column ++ ) {

			const at = base + NORMAL_OFFSET + column * 4;
			array[ at ] = normal[ column * 3 ];
			array[ at + 1 ] = normal[ column * 3 + 1 ];
			array[ at + 2 ] = normal[ column * 3 + 2 ];

		}

	}

	markDirty( id ) {

		if ( id < this.dirtyFirst ) this.dirtyFirst = id;
		if ( id > this.dirtyLast ) this.dirtyLast = id;

	}

}

function sameMatrix( array, offset, elements ) {

	for ( let i = 0; i < 16; i ++ ) {

		if ( array[ offset + i ] !== Math.fround( elements[ i ] ) ) return false;

	}

	return true;

}

export default GpuScene;
