
import { vec3, mat4, Fn } from '../tsl/TSLBase.js';
import { OnBeforeFrameUpdate } from '../utils/EventNode.js';
import { normalLocal, transformNormal } from './Normal.js';
import { positionLocal, positionPrevious } from './Position.js';
import { varyingProperty } from '../core/PropertyNode.js';
import { instancedBufferAttribute, instancedDynamicBufferAttribute } from './BufferAttributeNode.js';
import { buffer } from './BufferNode.js';
import { storage } from './StorageBufferNode.js';
import { instanceIndex } from '../core/IndexNode.js';

import { InstancedInterleavedBuffer } from '../../core/InstancedInterleavedBuffer.js';
import { InstancedBufferAttribute } from '../../core/InstancedBufferAttribute.js';
import { DynamicDrawUsage } from '../../constants.js';
import { instanceCullingFor } from '../../renderers/common/InstanceCulling.js';

const _matrixBuffers = /*@__PURE__*/ new WeakMap();
const _colorBuffers = /*@__PURE__*/ new WeakMap();
const _previousInstanceMatrices = /*@__PURE__*/ new WeakMap();

function createInstanceIdNode( builder ) {

	const culling = instanceCullingFor( builder.object, builder.camera );

	if ( culling === null ) return instanceIndex;

	return storage( culling.instanceIds, 'uint', culling.instanceIds.count ).element( instanceIndex.add( culling.idBase ) );

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
function createInstanceMatrixNode( builder, instanceMatrix, instanceId ) {

	const matrixCount = Math.max( instanceMatrix.count, 1 );

	if ( instanceMatrix.isStorageInstancedBufferAttribute === true ) {

		return storage( instanceMatrix, 'mat4', matrixCount ).element( instanceId );

	}

	if ( matrixCount * 16 * 4 <= builder.getUniformBufferLimit() ) {

		return buffer( instanceMatrix.array, 'mat4', matrixCount ).element( instanceId );

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

function previousMatricesOf( matrices ) {

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

export function previousInstanceMatricesOf( matrices ) {

	const previousMatrices = _previousInstanceMatrices.get( matrices );

	return previousMatrices === undefined ? null : previousMatrices.attribute;

}

function createPreviousInstanceMatrixNode( builder, matrices, instanceMatrixNode, instanceId ) {

	if ( matrices.isStorageInstancedBufferAttribute === true ) return instanceMatrixNode;

	const previousMatrices = previousMatricesOf( matrices );

	OnBeforeFrameUpdate( ( { frameId } ) => advancePreviousMatrices( previousMatrices, matrices, frameId ) );

	return createInstanceMatrixNode( builder, previousMatrices.attribute, instanceId );

}

function createInstanceColorNode( colors, instanceId ) {

	if ( colors.isStorageInstancedBufferAttribute === true ) {

		return { node: storage( colors, 'vec3', Math.max( colors.count, 1 ) ).element( instanceId ), interleaved: null };

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
	const instanceMatrixNode = createInstanceMatrixNode( builder, matrices, instanceId );
	const interleavedMatrix = _matrixBuffers.get( matrices ) || null;
	const color = colors ? createInstanceColorNode( colors, instanceId ) : null;
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
