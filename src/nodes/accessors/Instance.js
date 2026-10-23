
import { vec3, mat4, Fn } from '../tsl/TSLBase.js';
import { OnBeforeFrameUpdate } from '../utils/EventNode.js';
import { normalLocal, transformNormal } from './Normal.js';
import { positionLocal, positionPrevious } from './Position.js';
import { varyingProperty } from '../core/PropertyNode.js';
import { instancedBufferAttribute, instancedDynamicBufferAttribute } from './BufferAttributeNode.js';
import { buffer } from './BufferNode.js';
import { storage } from './StorageBufferNode.js';
import { instanceIndex } from '../core/IndexNode.js';
import { uniform } from '../core/UniformNode.js';

import { InstancedInterleavedBuffer } from '../../core/InstancedInterleavedBuffer.js';
import { InstancedBufferAttribute } from '../../core/InstancedBufferAttribute.js';
import { DynamicDrawUsage } from '../../constants.js';
import { instanceCullingFor } from '../../renderers/common/InstanceCulling.js';

const _matrixBuffers = /*@__PURE__*/ new WeakMap();
const _colorBuffers = /*@__PURE__*/ new WeakMap();
const _previousInstanceMatrices = /*@__PURE__*/ new WeakMap();
const _sharedStorageNodes = /*@__PURE__*/ new WeakMap();

export function sharedStorage( attribute, type ) {

	let byType = _sharedStorageNodes.get( attribute );

	if ( byType === undefined ) {

		byType = new Map();
		_sharedStorageNodes.set( attribute, byType );

	}

	let node = byType.get( type );

	if ( node === undefined ) {

		node = storage( attribute, type, Math.max( attribute.count, 1 ) );
		byType.set( type, node );

	}

	return node;

}

export const instanceIdBase = /*@__PURE__*/ uniform( 0, 'uint' ).onObjectUpdate( ( { object, camera } ) => {

	const culling = instanceCullingFor( object, camera );

	return culling !== null ? culling.idBase : 0;

} );

function createInstanceIdNode( builder ) {

	const culling = instanceCullingFor( builder.object, builder.camera );

	if ( culling === null ) return instanceIndex;

	return sharedStorage( culling.instanceIds, 'uint' ).element( instanceIndex.add( instanceIdBase ) );

}

function sceneBufferOf( builder, name ) {

	const culling = instanceCullingFor( builder.object, builder.camera );

	return culling !== null && culling[ name ] ? culling[ name ] : null;

}

/**
 * Creates the appropriate node for instanced matrix transformations.
 * Depending on buffer limits and storage capability, returns either a storage, buffer, or instanced interleaved attribute node.
 *
 * @param {NodeBuilder} builder - The current node builder.
 * @param {InstancedBufferAttribute|StorageInstancedBufferAttribute} instanceMatrix - The matrix buffer attribute.
 * @param {Node<uint>} instanceId - The index of the instance the vertex belongs to.
 * @returns {Node} The matrix node.
 */
function createInstanceMatrixNode( builder, instanceMatrix, instanceId, name = 'instanceMatrices' ) {

	const matrixCount = Math.max( instanceMatrix.count, 1 );

	if ( instanceMatrix.isStorageInstancedBufferAttribute === true ) {

		return storage( instanceMatrix, 'mat4', matrixCount ).setName( name ).element( instanceId );

	}

	if ( matrixCount * 16 * 4 <= builder.getUniformBufferLimit() ) {

		const matrices = buffer( instanceMatrix.array, 'mat4', matrixCount ).setName( name );
		Object.defineProperty( matrices, 'elementsVersion', { get: () => instanceMatrix.version } );
		return matrices.element( instanceId );

	}

	if ( instanceId !== instanceIndex ) throw new Error( 'Instance: a culled instanced mesh needs its instanceMatrix in a StorageInstancedBufferAttribute.' );

	let interleaved = _matrixBuffers.get( instanceMatrix );

	if ( ! interleaved ) {

		interleaved = new InstancedInterleavedBuffer( instanceMatrix.array, 16, 1 );
		_matrixBuffers.set( instanceMatrix, interleaved );

	}

	const bufferFn = instanceMatrix.usage === DynamicDrawUsage ? instancedDynamicBufferAttribute : instancedBufferAttribute;

	return mat4(
		bufferFn( interleaved, 'vec4', 16, 0 ),
		bufferFn( interleaved, 'vec4', 16, 4 ),
		bufferFn( interleaved, 'vec4', 16, 8 ),
		bufferFn( interleaved, 'vec4', 16, 12 )
	);

}

export function previousInstanceMatricesFor( matrices ) {

	let previousMatrices = _previousInstanceMatrices.get( matrices );

	if ( previousMatrices === undefined ) {

		previousMatrices = {
			attribute: matrices.clone(),
			current: matrices.array.slice(),
			currentVersion: matrices.version,
			behind: false,
			frameId: - 1
		};

		_previousInstanceMatrices.set( matrices, previousMatrices );

	}

	return previousMatrices;

}

function uploadPreviousMatrices( previousMatrices, source ) {

	previousMatrices.attribute.array.set( source );
	previousMatrices.attribute.needsUpdate = true;

	const interleaved = _matrixBuffers.get( previousMatrices.attribute );

	if ( interleaved !== undefined ) interleaved.needsUpdate = true;

}

export function advancePreviousMatrices( previousMatrices, matrices, frameId ) {

	if ( previousMatrices.frameId === frameId ) return;

	previousMatrices.frameId = frameId;

	if ( previousMatrices.currentVersion !== matrices.version ) {

		uploadPreviousMatrices( previousMatrices, previousMatrices.current );

		previousMatrices.current.set( matrices.array );
		previousMatrices.currentVersion = matrices.version;
		previousMatrices.behind = true;

	} else if ( previousMatrices.behind === true ) {

		uploadPreviousMatrices( previousMatrices, previousMatrices.current );

		previousMatrices.behind = false;

	}

}

function createPreviousInstanceMatrixNode( builder, matrices, instanceMatrixNode, instanceId ) {

	if ( matrices.isStorageInstancedBufferAttribute === true ) return instanceMatrixNode;

	const previousMatrices = previousInstanceMatricesFor( matrices );

	OnBeforeFrameUpdate( ( { frameId } ) => advancePreviousMatrices( previousMatrices, matrices, frameId ) );

	return createInstanceMatrixNode( builder, previousMatrices.attribute, instanceId, 'previousInstanceMatrices' );

}

function createInstanceColorNode( colors, instanceId ) {

	if ( colors.isStorageInstancedBufferAttribute === true ) {

		return { node: storage( colors, 'vec3', Math.max( colors.count, 1 ) ).setName( 'instanceColors' ).element( instanceId ), interleaved: null };

	}

	if ( instanceId !== instanceIndex ) throw new Error( 'Instance: a culled instanced mesh needs its instanceColor in a StorageInstancedBufferAttribute.' );

	let bufferAttribute = _colorBuffers.get( colors );

	if ( ! bufferAttribute ) {

		bufferAttribute = new InstancedBufferAttribute( colors.array, 3 );
		_colorBuffers.set( colors, bufferAttribute );

	}

	const bufferFn = colors.usage === DynamicDrawUsage ? instancedDynamicBufferAttribute : instancedBufferAttribute;

	return { node: vec3( bufferFn( bufferAttribute, 'vec3', 3, 0 ) ), interleaved: bufferAttribute };

}

function followSourceVersion( target, source ) {

	if ( target === null || target.version === source.version ) return;

	target.clearUpdateRanges();
	target.updateRanges.push( ...source.updateRanges );
	source.clearUpdateRanges();

	target.version = source.version;

}

/**
 * TSL object representing a varying property for the instanced color vector.
 *
 * @type {VaryingNode<vec3>}
 */
export const instanceColor = /*@__PURE__*/ varyingProperty( 'vec3', 'vInstanceColor' );

/**
 * TSL function representing the standard instancing vertex shader setup.
 * Transforms positionLocal and normalLocal, and assigns varying color in-place.
 *
 * @tsl
 * @function
 * @param {InstancedBufferAttribute|StorageInstancedBufferAttribute} matrices - The instanced transformation matrices.
 * @param {?InstancedBufferAttribute|StorageInstancedBufferAttribute} [colors=null] - The optional instanced colors.
 */
export const instance = /*@__PURE__*/ Fn( ( [ matrices, colors = null ], builder ) => {

	const instanceId = createInstanceIdNode( builder );
	const sceneMatrices = sceneBufferOf( builder, 'matrices' );
	const sceneColors = sceneBufferOf( builder, 'colors' );
	const instanceMatrixNode = sceneMatrices !== null ? sharedStorage( sceneMatrices, 'mat4' ).element( instanceId ) : createInstanceMatrixNode( builder, matrices, instanceId );
	const interleavedMatrix = _matrixBuffers.get( matrices ) || null;
	const color = colors ? ( sceneColors !== null ? { node: sharedStorage( sceneColors, 'vec3' ).element( instanceId ), interleaved: null } : createInstanceColorNode( colors, instanceId ) ) : null;
	const interleavedColor = color !== null ? color.interleaved : null;

	if ( interleavedMatrix !== null || interleavedColor !== null ) {

		OnBeforeFrameUpdate( () => {

			followSourceVersion( interleavedMatrix, matrices );
			if ( colors ) followSourceVersion( interleavedColor, colors );

		} );

	}

	positionLocal.assign( instanceMatrixNode.mul( positionLocal ).xyz );

	if ( builder.needsPreviousData() ) {

		const previousInstanceMatrixNode = createPreviousInstanceMatrixNode( builder, matrices, instanceMatrixNode, instanceId );
		positionPrevious.assign( previousInstanceMatrixNode.mul( positionPrevious ).xyz );

	}

	if ( builder.hasGeometryAttribute( 'normal' ) ) {

		normalLocal.assign( transformNormal( normalLocal, instanceMatrixNode ) );

	}

	if ( color !== null ) {

		instanceColor.assign( color.node );

	}

}, 'void' );

/**
 * TSL wrapper for applying instanced mesh rendering setup.
 *
 * @tsl
 * @function
 * @param {InstancedMesh} instancedMesh - The instanced mesh.
 */
export const instancedMesh = /*@__PURE__*/ Fn( ( [ instancedMesh ] ) => {

	const { instanceMatrix, instanceColor } = instancedMesh;

	instance( instanceMatrix, instanceColor );

}, 'void' );
