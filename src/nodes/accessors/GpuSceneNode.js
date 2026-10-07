import Node from '../core/Node.js';
import BufferAttributeNode from './BufferAttributeNode.js';
import { storage } from './StorageBufferNode.js';
import { renderGroup } from '../core/UniformGroupNode.js';
import { NodeUpdateType } from '../core/constants.js';
import { nodeImmutable, nodeObject, mat3, mat4, uint } from '../tsl/TSLBase.js';
import { PRIMITIVE_VEC4S, PrimitiveLayout, gpuScenePrimitiveTemplate } from '../../renderers/common/GpuScene.js';

class GpuScenePrimitiveNode extends BufferAttributeNode {

	static get type() {

		return 'GpuScenePrimitiveNode';

	}

	constructor() {

		super( gpuScenePrimitiveTemplate, 'uint' );

		this.isGpuScenePrimitiveNode = true;

	}

}

export const gpuScenePrimitive = /*@__PURE__*/ nodeObject( new GpuScenePrimitiveNode() );

export function gpuSceneRecords( gpuScene ) {

	if ( gpuScene.recordsNode === null ) gpuScene.recordsNode = storage( gpuScene.records, 'vec4' ).toReadOnly().setGroup( renderGroup );

	return gpuScene.recordsNode;

}

const RECORD_FIELD_TYPES = { world: 'mat4', previousWorld: 'mat4', normal: 'mat3', custom: 'vec4' };

class GpuSceneRecordNode extends Node {

	static get type() {

		return 'GpuSceneRecordNode';

	}

	constructor( field ) {

		super( RECORD_FIELD_TYPES[ field ] );

		this.field = field;

	}

	setup( builder ) {

		const records = gpuSceneRecords( builder.renderer.gpuScene );
		const base = gpuScenePrimitive.mul( uint( PRIMITIVE_VEC4S ) ).add( uint( PrimitiveLayout[ this.field ] ) );
		const column = ( index ) => records.element( base.add( uint( index ) ) );

		if ( this.field === 'normal' ) return mat3( column( 0 ).xyz, column( 1 ).xyz, column( 2 ).xyz );
		if ( this.field === 'custom' ) return column( 0 );

		return mat4( column( 0 ), column( 1 ), column( 2 ), column( 3 ) );

	}

}

class GpuScenePrimitiveWorldNode extends Node {

	static get type() {

		return 'GpuScenePrimitiveWorldNode';

	}

	constructor( primitive, field = 'world' ) {

		super( 'mat4' );

		this.primitive = primitive;
		this.field = field;

	}

	setup( builder ) {

		const records = gpuSceneRecords( builder.renderer.gpuScene );
		const base = uint( this.primitive ).mul( uint( PRIMITIVE_VEC4S ) ).add( uint( PrimitiveLayout[ this.field ] ) ).toVar();
		const column = ( index ) => records.element( base.add( uint( index ) ) );

		return mat4( column( 0 ), column( 1 ), column( 2 ), column( 3 ) );

	}

}

export const gpuSceneWorldOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive ) );
export const gpuScenePreviousWorldOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive, 'previousWorld' ) );

export const gpuSceneWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'world' );
export const gpuScenePreviousWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'previousWorld' );
export const gpuSceneNormalMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'normal' );
export const gpuSceneCustomData = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'custom' );

export const usesGpuScene = ( builder ) => builder.renderer.gpuScene !== null && builder.renderer.gpuScene !== undefined;

export function bindingsFollowMaterial( object, { updateNodes, updateBeforeNodes, updateAfterNodes } ) {

	if ( isPlainMesh( object ) === false ) return false;

	return updateNodes.every( ( node ) => updatesFromMaterial( node, node.updateType, 'update' ) )
		&& updateBeforeNodes.every( ( node ) => updatesFromMaterial( node, node.updateBeforeType, 'updateBefore' ) )
		&& updateAfterNodes.every( ( node ) => updatesFromMaterial( node, node.updateAfterType, 'updateAfter' ) );

}

function isPlainMesh( object ) {

	if ( object === null || object.isMesh !== true || object.isInstancedMesh === true || object.isSkinnedMesh === true || object.isBatchedMesh === true ) return false;

	return Object.keys( object.geometry.morphAttributes ).length === 0;

}

function updatesFromMaterial( node, updateType, method ) {

	if ( updateType !== NodeUpdateType.OBJECT ) return true;

	if ( Object.hasOwn( node, method ) ) return false;

	return node.isMaterialReferenceNode === true || node.isTextureNode === true || node.isVelocityNode === true || ( node.isModelNode === true && node.readsGpuScene() );

}
