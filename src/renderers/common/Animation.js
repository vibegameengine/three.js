
/**
 * This module manages the internal animation loop of the renderer.
 *
 * @private
 */
class Animation {

	/**
	 * Constructs a new animation loop management component.
	 *
	 * @param {Renderer} renderer - A reference to the main renderer.
	 * @param {Nodes} nodes - Renderer component for managing nodes related logic.
	 * @param {Info} info - Renderer component for managing metrics and monitoring data.
	 */
	constructor( renderer, nodes, info ) {

		/**
		 * A reference to the main renderer.
		 *
		 * @type {Renderer}
		 */
		this.renderer = renderer;

		/**
		 * Renderer component for managing nodes related logic.
		 *
		 * @type {Nodes}
		 */
		this.nodes = nodes;

		/**
		 * Renderer component for managing metrics and monitoring data.
		 *
		 * @type {Info}
		 */
		this.info = info;

		/**
		 * A reference to the context from `requestAnimationFrame()` can
		 * be called (usually `window`).
		 *
		 * @type {?(Window|XRSession)}
		 */
		this._context = typeof self !== 'undefined' ? self : null;

		/**
		 * The user-defined animation loop.
		 *
		 * @type {?Function}
		 * @default null
		 */
		this._animationLoop = null;

		/**
		 * The requestId which is returned from the `requestAnimationFrame()` call.
		 * Can be used to cancel the stop the animation loop.
		 *
		 * @type {?number}
		 * @default null
		 */
		this._requestId = null;

		/**
		 * When the last frame admitted under `renderer.maxFrameRate` was due.
		 *
		 * @type {number}
		 * @default -Infinity
		 */
		this._lastFrameDue = - Infinity;

	}

	/**
	 * Whether a display tick at `time` is due under `renderer.maxFrameRate`. The
	 * schedule advances by whole intervals so a 144 Hz display capped at 60 averages
	 * 60, and it restarts after a stall instead of bursting to catch up.
	 *
	 * @private
	 * @param {number|undefined} time - The `requestAnimationFrame()` timestamp.
	 * @return {boolean} Whether this tick runs a frame.
	 */
	_frameDue( time ) {

		const maxFrameRate = this.renderer.maxFrameRate;

		if ( ! ( maxFrameRate > 0 ) || time === undefined ) return true;

		const interval = 1000 / maxFrameRate;
		const displayJitter = 1;

		if ( time - this._lastFrameDue < interval - displayJitter ) return false;

		this._lastFrameDue += interval;

		if ( time - this._lastFrameDue > interval || ! Number.isFinite( this._lastFrameDue ) ) this._lastFrameDue = time;

		return true;

	}

	/**
	 * Starts the internal animation loop.
	 */
	start() {

		const update = ( time, xrFrame ) => {

			this._requestId = this._context.requestAnimationFrame( update );

			if ( ! this._frameDue( time ) ) return;

			if ( this.info.autoReset === true ) this.info.reset();

			this.nodes.nodeFrame.update();

			this.info.frame = this.nodes.nodeFrame.frameId;

			this.renderer._inspector.begin();

			if ( this._animationLoop !== null ) this._animationLoop( time, xrFrame );

			this.renderer._inspector.finish();

		};

		update();

	}

	/**
	 * Stops the internal animation loop.
	 */
	stop() {

		this._context.cancelAnimationFrame( this._requestId );

		this._requestId = null;

	}

	/**
	 * Returns the user-level animation loop.
	 *
	 * @return {?Function} The animation loop.
	 */
	getAnimationLoop() {

		return this._animationLoop;

	}

	/**
	 * Defines the user-level animation loop.
	 *
	 * @param {?Function} callback - The animation loop.
	 */
	setAnimationLoop( callback ) {

		this._animationLoop = callback;

	}

	/**
	 * Returns the animation context.
	 *
	 * @return {Window|XRSession} The animation context.
	 */
	getContext() {

		return this._context;

	}

	/**
	 * Defines the context in which `requestAnimationFrame()` is executed.
	 *
	 * @param {Window|XRSession} context - The context to set.
	 */
	setContext( context ) {

		this._context = context;

	}

	/**
	 * Frees all internal resources and stops the animation loop.
	 */
	dispose() {

		this.stop();

	}

}

export default Animation;
