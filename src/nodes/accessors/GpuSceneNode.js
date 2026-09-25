import Node from '../core/Node.js';
import BufferAttributeNode from './BufferAttributeNode.js';
import { storage } from './StorageBufferNode.js';
import { renderGroup } from '../core/UniformGroupNode.js';
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

class GpuSceneRecordNode extends Node {

	static get type() {

		return 'GpuSceneRecordNode';

	}

	constructor( field ) {

		super( field === 'normal' ? 'mat3' : 'mat4' );

		this.field = field;

	}

	setup( builder ) {

		const records = gpuSceneRecords( builder.renderer.gpuScene );
		const base = gpuScenePrimitive.mul( uint( PRIMITIVE_VEC4S ) ).add( uint( PrimitiveLayout[ this.field ] ) );
		const column = ( index ) => records.element( base.add( uint( index ) ) );

		if ( this.field === 'normal' ) return mat3( column( 0 ).xyz, column( 1 ).xyz, column( 2 ).xyz );

		return mat4( column( 0 ), column( 1 ), column( 2 ), column( 3 ) );

	}

}

export const gpuSceneWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'world' );
export const gpuScenePreviousWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'previousWorld' );
export const gpuSceneNormalMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'normal' );

export const usesGpuScene = ( builder ) => builder.renderer.gpuScene !== null && builder.renderer.gpuScene !== undefined;
