import ChainMap from './ChainMap.js';
import RenderContext from './RenderContext.js';
import { Scene } from '../../scenes/Scene.js';
import { Camera } from '../../cameras/Camera.js';

const _chainKeys = [];
const _defaultScene = /*@__PURE__*/ new Scene();
const _defaultCamera = /*@__PURE__*/ new Camera();

function attachmentStateOf( renderTarget ) {

	if ( renderTarget === null ) return 'default';

	const format = renderTarget.texture.format;
	const type = renderTarget.texture.type;
	const count = renderTarget.textures.length;

	return `${ count }:${ format }:${ type }:${ renderTarget.samples }:${ renderTarget.depthBuffer }:${ renderTarget.stencilBuffer }`;

}

/**
 * This module manages the render contexts of the renderer.
 *
 * @private
 */
class RenderContexts {

	/**
	 * Constructs a new render context management component.
	 *
	 * @param {Renderer} renderer - The renderer.
	 */
	constructor( renderer ) {

		/**
		 * The renderer.
		 *
		 * @type {Renderer}
		 */
		this.renderer = renderer;

		/**
		 * A dictionary that manages render contexts in chain maps
		 * for each attachment state.
		 *
		 * @type {Object<string,ChainMap>}
		 */
		this.chainMaps = {};

	}

	/**
	 * Returns a render context for the given scene, camera and render target.
	 *
	 * @param {Object3D} scene - The scene.
	 * @param {Camera} camera - The camera that is used to render the scene.
	 * @param {?RenderTarget} [renderTarget=null] - The active render target.
	 * @param {?MRTNode} [mrt=null] - The MRT configuration
	 * @param {?number} [callDepth=0] - The call depth of the renderer.
	 * @return {RenderContext} The render context.
	 */
	get( scene, camera, renderTarget = null, mrt = null, callDepth = 0 ) {

		const mrtState = ( mrt !== null ) ? mrt.id : 'default';
		const chainMap = this._getChainMap( attachmentStateOf( renderTarget ) + '-' + mrtState + '-' + callDepth );

		_chainKeys[ 0 ] = scene;
		_chainKeys[ 1 ] = camera;

		let renderState = chainMap.get( _chainKeys );

		if ( renderState === undefined ) {

			renderState = new RenderContext();
			renderState.mrt = mrt;

			chainMap.set( _chainKeys, renderState );

		}

		_chainKeys[ 0 ] = null;
		_chainKeys[ 1 ] = null;

		if ( renderTarget !== null ) renderState.sampleCount = renderTarget.samples === 0 ? 1 : renderTarget.samples;

		renderState.clearDepthValue = this.renderer.getClearDepth();
		renderState.clearStencilValue = this.renderer.getClearStencil();

		return renderState;

	}

	/**
	 * Returns a render context of the given render target that belongs to no view.
	 *
	 * @param {?RenderTarget} [renderTarget=null] - The active render target.
	 * @param {?number} [callDepth=0] - The call depth of the renderer.
	 * @return {RenderContext} The render context.
	 */
	getForTarget( renderTarget = null, callDepth = 0 ) {

		return this.get( _defaultScene, _defaultCamera, renderTarget, null, callDepth );

	}

	_getChainMap( renderStateKey ) {

		return this.chainMaps[ renderStateKey ] || ( this.chainMaps[ renderStateKey ] = new ChainMap() );

	}

	/**
	 * Frees internal resources.
	 */
	dispose() {

		this.chainMaps = {};

	}

}

export default RenderContexts;
