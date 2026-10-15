
import { Fn, add, uniform, int, ivec2, mat3, mat4 } from '../tsl/TSLBase.js';
import { attribute } from '../core/AttributeNode.js';
import { OnObjectUpdate } from '../utils/EventNode.js';
import { normalLocal } from './Normal.js';
import { positionLocal, positionPrevious } from './Position.js';
import { tangentLocal } from './Tangent.js';
import { reference, referenceBuffer } from './ReferenceNode.js';
import { buffer } from './BufferNode.js';
import { storage } from './StorageBufferNode.js';
import { texture } from './TextureNode.js';
import { textureSize } from './TextureSizeNode.js';
import { instanceIndex, vertexIndex } from '../core/IndexNode.js';

import { InstancedBufferAttribute } from '../../core/InstancedBufferAttribute.js';
import { DataTexture } from '../../textures/DataTexture.js';
import { RGBAFormat, FloatType } from '../../constants.js';

const _skeletonsUpdated = /*@__PURE__*/ new WeakMap();
const _previousBoneMatricesData = /*@__PURE__*/ new WeakMap();

const INFLUENCE_LANES = [ 'x', 'y', 'z', 'w' ];

/**
 * Creates an accessor for bone matrices stored in a bone texture.
 *
 * @param {TextureNode} boneTexture - The bone texture node.
 * @returns {Object} An accessor with the same `element()` interface as a buffer node.
 */
function getBoneTextureMatrices( boneTexture ) {

	return {
		element: ( i ) => {

			const size = int( textureSize( boneTexture ).x ).toConst();
			const j = int( i ).mul( 4 ).toConst();
			const y = j.div( size ).toConst();
			const x = j.sub( y.mul( size ) ).toConst();

			return mat4(
				boneTexture.load( ivec2( x, y ) ),
				boneTexture.load( ivec2( x.add( 1 ), y ) ),
				boneTexture.load( ivec2( x.add( 2 ), y ) ),
				boneTexture.load( ivec2( x.add( 3 ), y ) )
			);

		}
	};

}

/**
 * Creates the bone matrices node. Skeletons that fit within the uniform buffer limit
 * use a uniform buffer, larger skeletons fall back to a bone texture.
 *
 * @param {NodeBuilder} builder - The current node builder.
 * @param {Skeleton} skeleton - The skeleton.
 * @returns {Object} The bone matrices node.
 */
function getBoneMatricesNode( builder, skeleton ) {

	let node;

	const uniformBufferSize = skeleton.bones.length * 16 * 4;

	if ( uniformBufferSize <= builder.getUniformBufferLimit() ) {

		node = referenceBuffer( 'skeleton.boneMatrices', 'mat4', skeleton.bones.length );

	} else {

		if ( skeleton.boneTexture === null ) skeleton.computeBoneTexture();

		const boneTexture = texture( skeleton.boneTexture );

		OnObjectUpdate( ( { object } ) => {

			const skeleton = object.skeleton;

			if ( skeleton.boneTexture === null ) skeleton.computeBoneTexture();

			boneTexture.value = skeleton.boneTexture;

		} );

		node = getBoneTextureMatrices( boneTexture );

	}

	return node;

}

/**
 * Computes the skinned position by applying bone matrices based on weights.
 *
 * @param {Node} boneMatrices - The bone matrices buffer or storage node.
 * @param {Node<vec3>} position - The vertex position to transform.
 * @param {Node<mat4>} bindMatrix - The bind matrix node.
 * @param {Node<mat4>} bindMatrixInverse - The inverse bind matrix node.
 * @returns {Node<vec3>} The skinned position.
 */
function getSkinnedPosition( boneMatrices, position, bindMatrix, bindMatrixInverse, influences ) {

	const skinVertex = bindMatrix.mul( position );

	const skinned = add( ...influences.flatMap( ( [ skinIndex, skinWeight ] ) => INFLUENCE_LANES.map( ( lane ) => boneMatrices.element( skinIndex[ lane ] ).mul( skinWeight[ lane ] ).mul( skinVertex ) ) ) );

	return bindMatrixInverse.mul( skinned ).xyz;

}

/**
 * Computes the skinned normal and tangent vectors by applying bone matrices based on weights.
 *
 * @param {Node} boneMatrices - The bone matrices buffer or storage node.
 * @param {Node<vec3>} normal - The normal vector in local space.
 * @param {Node<vec3>} tangent - The tangent vector in local space.
 * @param {Node<mat4>} bindMatrix - The bind matrix node.
 * @param {Node<mat4>} bindMatrixInverse - The inverse bind matrix node.
 * @returns {{skinNormal: Node<vec3>, skinTangent: Node<vec3>}} The skinned normal and tangent.
 */
function getSkinnedNormalAndTangent( boneMatrices, normal, tangent, bindMatrix, bindMatrixInverse, influences ) {

	let skinMatrix = add( ...influences.flatMap( ( [ skinIndex, skinWeight ] ) => INFLUENCE_LANES.map( ( lane ) => skinWeight[ lane ].mul( boneMatrices.element( skinIndex[ lane ] ) ) ) ) );

	skinMatrix = bindMatrixInverse.mul( skinMatrix ).mul( bindMatrix );

	const skinMatrix3 = mat3( skinMatrix );

	const skinNormal = skinMatrix3.mul( normal );
	const skinTangent = skinMatrix3.mul( tangent );

	return { skinNormal, skinTangent };

}

/**
 * Retrieves or initializes the previous frame skinned position node for motion vectors.
 * Uses a WeakMap to cache previous frame bone matrix arrays and their TSL buffer nodes.
 *
 * @param {NodeBuilder} builder - The current node builder.
 * @param {SkinnedMesh} skinnedMesh - The skinned mesh.
 * @param {Node<mat4>} bindMatrixNode - The bind matrix node.
 * @param {Node<mat4>} bindMatrixInverseNode - The inverse bind matrix node.
 * @returns {Node<vec3>} The skinned position from the previous frame.
 */
function getPreviousSkinnedPosition( builder, skinnedMesh, bindMatrixNode, bindMatrixInverseNode, influences ) {

	const skeleton = skinnedMesh.skeleton;

	let data = _previousBoneMatricesData.get( skeleton );

	if ( data === undefined ) {

		skeleton.update();

		const uniformBufferSize = skeleton.bones.length * 16 * 4;

		if ( uniformBufferSize <= builder.getUniformBufferLimit() ) {

			const previousBoneMatrices = new Float32Array( skeleton.boneMatrices );

			data = {
				previousBoneMatrices,
				previousBoneTexture: null,
				node: buffer( previousBoneMatrices, 'mat4', skeleton.bones.length )
			};

		} else {

			if ( skeleton.boneTexture === null ) skeleton.computeBoneTexture();

			const { width, height } = skeleton.boneTexture.image;

			const previousBoneMatrices = new Float32Array( skeleton.boneMatrices );
			const previousBoneTexture = new DataTexture( previousBoneMatrices, width, height, RGBAFormat, FloatType );
			previousBoneTexture.needsUpdate = true;

			data = {
				previousBoneMatrices,
				previousBoneTexture,
				node: getBoneTextureMatrices( texture( previousBoneTexture ) )
			};

		}

		_previousBoneMatricesData.set( skeleton, data );

	}

	return getSkinnedPosition( data.node, positionPrevious, bindMatrixNode, bindMatrixInverseNode, influences );

}

function influencesOf( builder ) {

	const influences = [ [ attribute( 'skinIndex', 'uvec4' ), attribute( 'skinWeight', 'vec4' ) ] ];

	for ( let set = 1; builder.hasGeometryAttribute( `skinIndex${ set }` ); set ++ ) {

		influences.push( [ attribute( `skinIndex${ set }`, 'uvec4' ), attribute( `skinWeight${ set }`, 'vec4' ) ] );

	}

	return influences;

}

function deformedFromSkinCache( vertexAttribute ) {

	return storage( vertexAttribute, 'vec4', vertexAttribute.count ).toReadOnly().element( vertexIndex ).xyz;

}

function skinningFromSkinCache( builder, skinCache ) {

	if ( builder.needsPreviousData() ) {

		positionPrevious.assign( deformedFromSkinCache( skinCache.previousPositions ) );

	}

	positionLocal.assign( deformedFromSkinCache( skinCache.positions ) );

	if ( builder.hasGeometryAttribute( 'normal' ) ) {

		const skinNormal = deformedFromSkinCache( skinCache.normals );

		normalLocal.assign( skinNormal );

		if ( builder.hasGeometryAttribute( 'tangent' ) ) {

			tangentLocal.assign( skinNormal );

		}

	}

}

/**
 * TSL function representing the standard skeletal animation vertex shader setup.
 * Transforms positionLocal, normalLocal, and tangentLocal in-place.
 *
 * @tsl
 * @function
 * @param {SkinnedMesh} skinnedMesh - The skinned mesh.
 */
export const skinning = /*@__PURE__*/ Fn( ( [ skinnedMesh ], builder ) => {

	if ( skinnedMesh.skinCache !== undefined ) {

		skinningFromSkinCache( builder, skinnedMesh.skinCache );

		return;

	}

	const influences = influencesOf( builder );
	const bindMatrixNode = reference( 'bindMatrix', 'mat4' );
	const bindMatrixInverseNode = reference( 'bindMatrixInverse', 'mat4' );
	const boneMatricesNode = getBoneMatricesNode( builder, skinnedMesh.skeleton );

	OnObjectUpdate( ( { object, frameId } ) => {

		const skeleton = object.skeleton;

		if ( _skeletonsUpdated.get( skeleton ) !== frameId ) {

			_skeletonsUpdated.set( skeleton, frameId );

			const skeletonData = _previousBoneMatricesData.get( skeleton );

			if ( skeletonData !== undefined ) {

				skeletonData.previousBoneMatrices.set( skeleton.boneMatrices );

				if ( skeletonData.previousBoneTexture !== null ) {

					skeletonData.previousBoneTexture.needsUpdate = true;

				}

			}

			skeleton.update();

		}

	} );

	if ( builder.needsPreviousData() ) {

		const previousSkinnedPosition = getPreviousSkinnedPosition( builder, skinnedMesh, bindMatrixNode, bindMatrixInverseNode, influences );

		positionPrevious.assign( previousSkinnedPosition );

	}

	const skinPosition = getSkinnedPosition( boneMatricesNode, positionLocal, bindMatrixNode, bindMatrixInverseNode, influences );
	positionLocal.assign( skinPosition );

	if ( builder.hasGeometryAttribute( 'normal' ) ) {

		const { skinNormal, skinTangent } = getSkinnedNormalAndTangent( boneMatricesNode, normalLocal, tangentLocal, bindMatrixNode, bindMatrixInverseNode, influences );

		normalLocal.assign( skinNormal );

		if ( builder.hasGeometryAttribute( 'tangent' ) ) {

			tangentLocal.assign( skinTangent );

		}

	}

}, 'void' );

/**
 * TSL function that computes skeletal animation for custom compute passes.
 *
 * @tsl
 * @function
 * @param {SkinnedMesh} skinnedMesh - The skinned mesh.
 * @param {Node<vec3>} [toPosition=null] - The target position node to assign.
 * @returns {Node<vec3>} The computed skinned position node.
 */
export const computeSkinning = /*@__PURE__*/ Fn( ( [ skinnedMesh, toPosition = null ], builder ) => {

	const positionNode = storage( new InstancedBufferAttribute( skinnedMesh.geometry.getAttribute( 'position' ).array, 3 ), 'vec3' ).setPBO( true ).toReadOnly().element( instanceIndex ).toVar();
	const skinIndexNode = storage( new InstancedBufferAttribute( new Uint32Array( skinnedMesh.geometry.getAttribute( 'skinIndex' ).array ), 4 ), 'uvec4' ).setPBO( true ).toReadOnly().element( instanceIndex ).toVar();
	const skinWeightNode = storage( new InstancedBufferAttribute( skinnedMesh.geometry.getAttribute( 'skinWeight' ).array, 4 ), 'vec4' ).setPBO( true ).toReadOnly().element( instanceIndex ).toVar();
	const influences = [ [ skinIndexNode, skinWeightNode ] ];
	const bindMatrixNode = uniform( skinnedMesh.bindMatrix, 'mat4' );
	const bindMatrixInverseNode = uniform( skinnedMesh.bindMatrixInverse, 'mat4' );
	const boneMatricesNode = buffer( skinnedMesh.skeleton.boneMatrices, 'mat4', skinnedMesh.skeleton.bones.length );

	const skeleton = skinnedMesh.skeleton;

	OnObjectUpdate( ( { frameId } ) => {

		if ( _skeletonsUpdated.get( skeleton ) !== frameId ) {

			_skeletonsUpdated.set( skeleton, frameId );

			const state = _previousBoneMatricesData.get( skeleton );

			if ( state !== undefined ) {

				state.previousBoneMatrices.set( skeleton.boneMatrices );

				if ( state.previousBoneTexture !== null ) {

					state.previousBoneTexture.needsUpdate = true;

				}

			}

			skeleton.update();

		}

	} );

	if ( builder.needsPreviousData() ) {

		const previousSkinnedPosition = getPreviousSkinnedPosition( builder, skinnedMesh, bindMatrixNode, bindMatrixInverseNode, influences );

		positionPrevious.assign( previousSkinnedPosition );

	}

	const skinPosition = getSkinnedPosition( boneMatricesNode, positionNode, bindMatrixNode, bindMatrixInverseNode, influences );

	if ( toPosition !== null ) {

		toPosition.assign( skinPosition );

	}

	if ( builder.hasGeometryAttribute( 'normal' ) ) {

		const { skinNormal, skinTangent } = getSkinnedNormalAndTangent( boneMatricesNode, normalLocal, tangentLocal, bindMatrixNode, bindMatrixInverseNode, influences );

		normalLocal.assign( skinNormal );

		if ( builder.hasGeometryAttribute( 'tangent' ) ) {

			tangentLocal.assign( skinTangent );

		}

	}

	return skinPosition;

} );


