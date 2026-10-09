import { Fn, If, instanceIndex, storage, uint, uniform } from '../../nodes/TSL.js';
import { PRIMITIVE_VEC4S } from './GpuScene.js';

class GpuSceneScatter {

	constructor() {

		this.vec4Count = uniform( 0, 'uint' );
		this.records = null;
		this.packed = null;
		this.node = null;

	}

	dispatch( renderer, gpuScene, count ) {

		if ( this.records !== gpuScene.records || this.packed !== gpuScene.scatter.records ) this._build( gpuScene );

		const vec4s = count * PRIMITIVE_VEC4S;
		this.vec4Count.value = vec4s;
		renderer.compute( this.node, vec4s );

	}

	_build( gpuScene ) {

		if ( this.node !== null ) this.node.dispose();

		this.records = gpuScene.records;
		this.packed = gpuScene.scatter.records;

		const records = storage( this.records, 'vec4', this.records.count );
		const packed = storage( this.packed, 'vec4', this.packed.count ).toReadOnly();
		const ids = storage( gpuScene.scatter.ids, 'uint', gpuScene.scatter.ids.count ).toReadOnly();
		const vec4Count = this.vec4Count;
		const stride = uint( PRIMITIVE_VEC4S );

		this.node = Fn( () => {

			If( instanceIndex.lessThan( vec4Count ), () => {

				const slot = instanceIndex.div( stride ).toVar();
				const lane = instanceIndex.sub( slot.mul( stride ) );
				records.element( ids.element( slot ).mul( stride ).add( lane ) ).assign( packed.element( instanceIndex ) );

			} );

		} )().compute( gpuScene.capacity * PRIMITIVE_VEC4S ).setName( 'GpuScene.Scatter' );

	}

}

export default GpuSceneScatter;
