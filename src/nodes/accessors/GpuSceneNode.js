import Node from '../core/Node.js';
import BufferAttributeNode from './BufferAttributeNode.js';
import { storage } from './StorageBufferNode.js';
import { renderGroup } from '../core/UniformGroupNode.js';
import { NodeUpdateScope, NodeUpdateType } from '../core/constants.js';
import { nodeImmutable, nodeObject, float, mat3, mat4, uint, vec4 } from '../tsl/TSLBase.js';
import { abs, cross, dot } from '../math/MathNode.js';
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

const SINGULAR_DETERMINANT = 1e-30;

export function affineCofactors( world ) {

	const c0 = world[ 0 ].xyz.toVar(), c1 = world[ 1 ].xyz.toVar(), c2 = world[ 2 ].xyz.toVar();
	const r0 = cross( c1, c2 ).toVar(), r1 = cross( c2, c0 ).toVar(), r2 = cross( c0, c1 ).toVar();
	const determinant = dot( c0, r0 );
	const inverseDeterminant = abs( determinant ).greaterThan( SINGULAR_DETERMINANT ).select( float( 1 ).div( determinant ), float( 0 ) ).toVar();

	return { r0, r1, r2, inverseDeterminant };

}

export function affineNormalMatrix( world ) {

	const { r0, r1, r2, inverseDeterminant } = affineCofactors( world );

	return mat3( r0.mul( inverseDeterminant ), r1.mul( inverseDeterminant ), r2.mul( inverseDeterminant ) );

}

export function affineInverse( world ) {

	const { r0, r1, r2, inverseDeterminant } = affineCofactors( world );
	const translation = world[ 3 ].xyz;
	const row0 = r0.mul( inverseDeterminant ).toVar(), row1 = r1.mul( inverseDeterminant ).toVar(), row2 = r2.mul( inverseDeterminant ).toVar();

	return mat4(
		vec4( row0.x, row1.x, row2.x, 0 ),
		vec4( row0.y, row1.y, row2.y, 0 ),
		vec4( row0.z, row1.z, row2.z, 0 ),
		vec4( dot( row0, translation ).negate(), dot( row1, translation ).negate(), dot( row2, translation ).negate(), 1 )
	);

}

const RECORD_FIELD_TYPES = { world: 'mat4', previousWorld: 'mat4', normal: 'mat3', custom: 'vec4', worldInverse: 'mat4' };

function recordMatrix( records, base ) {

	const column = ( index ) => records.element( base.add( uint( index ) ) );

	return mat4( column( 0 ), column( 1 ), column( 2 ), column( 3 ) );

}

function primitiveField( records, primitive, field ) {

	const recordBase = uint( primitive ).mul( uint( PRIMITIVE_VEC4S ) ).toVar();

	if ( field === 'custom' ) return records.element( recordBase.add( uint( PrimitiveLayout.custom ) ) );
	if ( field === 'previousWorld' ) return recordMatrix( records, recordBase.add( uint( PrimitiveLayout.previousWorld ) ) );

	const world = recordMatrix( records, recordBase.add( uint( PrimitiveLayout.world ) ) );

	if ( field === 'normal' ) return affineNormalMatrix( world.toVar() );
	if ( field === 'worldInverse' ) return affineInverse( world.toVar() );

	return world;

}

class GpuSceneRecordNode extends Node {

	static get type() {

		return 'GpuSceneRecordNode';

	}

	constructor( field ) {

		super( RECORD_FIELD_TYPES[ field ] );

		this.field = field;

	}

	setup( builder ) {

		return primitiveField( gpuSceneRecords( builder.renderer.gpuScene ), gpuScenePrimitive, this.field );

	}

}

class GpuScenePrimitiveWorldNode extends Node {

	static get type() {

		return 'GpuScenePrimitiveWorldNode';

	}

	constructor( primitive, field = 'world' ) {

		super( RECORD_FIELD_TYPES[ field ] );

		this.primitive = primitive;
		this.field = field;

	}

	setup( builder ) {

		return primitiveField( gpuSceneRecords( builder.renderer.gpuScene ), this.primitive, this.field );

	}

}

export const gpuSceneWorldOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive ) );
export const gpuScenePreviousWorldOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive, 'previousWorld' ) );
export const gpuSceneWorldInverseOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive, 'worldInverse' ) );
export const gpuSceneNormalOf = ( primitive ) => nodeObject( new GpuScenePrimitiveWorldNode( primitive, 'normal' ) );

export const gpuSceneWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'world' );
export const gpuScenePreviousWorldMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'previousWorld' );
export const gpuSceneNormalMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'normal' );
export const gpuSceneCustomData = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'custom' );
export const gpuSceneWorldInverseMatrix = /*@__PURE__*/ nodeImmutable( GpuSceneRecordNode, 'worldInverse' );

export const usesGpuScene = ( builder ) => builder.renderer.gpuScene !== null && builder.renderer.gpuScene !== undefined;

export function bindingsFollowMaterial( object, { updateNodes, updateBeforeNodes, updateAfterNodes } ) {

	if ( isPlainMesh( object ) === false ) return false;

	return updateNodes.every( ( node ) => updatesFromMaterial( node, node.updateType ) )
		&& updateBeforeNodes.every( ( node ) => updatesFromMaterial( node, node.updateBeforeType ) )
		&& updateAfterNodes.every( ( node ) => updatesFromMaterial( node, node.updateAfterType ) );

}

function isPlainMesh( object ) {

	if ( object === null || object.isMesh !== true || object.isInstancedMesh === true || object.isSkinnedMesh === true || object.isBatchedMesh === true ) return false;

	return Object.keys( object.geometry.morphAttributes ).length === 0;

}

const SHARED_ACROSS_OBJECTS = new Set( [ NodeUpdateScope.MATERIAL, NodeUpdateScope.PRIMITIVE, NodeUpdateScope.VIEW ] );

function updatesFromMaterial( node, updateType ) {

	return updateType !== NodeUpdateType.OBJECT || SHARED_ACROSS_OBJECTS.has( node.updateScope );

}

export function requireDeclaredScopes( { updateNodes, updateBeforeNodes, updateAfterNodes } ) {

	const undeclared = [
		...updateNodes.filter( ( node ) => node.updateType === NodeUpdateType.OBJECT ),
		...updateBeforeNodes.filter( ( node ) => node.updateBeforeType === NodeUpdateType.OBJECT ),
		...updateAfterNodes.filter( ( node ) => node.updateAfterType === NodeUpdateType.OBJECT )
	].filter( ( node ) => node.updateScope === null || node.updateScope === undefined );

	if ( undeclared.length > 0 ) {

		const names = [ ...new Set( undeclared.map( ( node ) => node.constructor.type ?? node.constructor.name ) ) ].join( ', ' );
		throw new Error( `GpuScene: ${ names } update per object without a declared update scope (view, primitive, material or object); declare it with setUpdateScope().` );

	}

}
