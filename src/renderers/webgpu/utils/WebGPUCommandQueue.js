const UNKNOWN = 0;
const VALID = 1;
const INVALID = 2;

/**
 * Collects the command buffers of a frame and submits them together, instead of one
 * `GPUQueue.submit` per pass.
 *
 * It installs itself on the device and watches every command encoder and pass, so every
 * caller goes through it, three's own code or not.
 *
 * Order. `queue.writeBuffer` is ordered against submits, not against command buffers still
 * waiting here, so a write into a buffer that a waiting command buffer references submits
 * the waiting ones first; the buffers of an encoder still recording join only when its
 * command buffer arrives, because a write into those landed before it then too. Texture
 * writes, external image copies, `onSubmittedWorkDone`, the mapping of a readable buffer
 * and the destruction of a buffer or texture submit first as well. Whatever is still
 * waiting when the current task ends is submitted from a microtask.
 *
 * Failure. A submit that holds one invalid command buffer is rejected whole, so a command
 * buffer that uses a pipeline, bind group, buffer or texture not yet known to be valid is
 * submitted on its own and can lose nothing but itself. Validity comes from the error
 * scope an object was created in: someone else's scope is read, not taken over, and where
 * there is none the queue opens its own and reports what it catches. A command buffer can
 * also be invalid from how it was encoded, which WebGPU reports only after the submit; if a
 * batch is ever rejected, that frame is lost and every later command buffer is submitted on
 * its own, which is what three did before this queue.
 */
class WebGPUCommandQueue {

	/**
	 * @param {GPUDevice} device - The device whose queue is batched.
	 */
	constructor( device ) {

		this.device = device;
		this.waiting = [];
		this.referenced = new Set();
		this.validity = new WeakMap();
		this.buffersOfGroup = new WeakMap();
		this.textureOfView = new WeakMap();
		this.recordings = new WeakMap();
		this.scopes = [];
		this.batching = true;
		this.flushScheduled = false;
		this.submits = 0;

		const queue = device.queue;

		this._submit = queue.submit.bind( queue );
		this._pushErrorScope = device.pushErrorScope.bind( device );
		this._popErrorScope = device.popErrorScope.bind( device );

		this._scheduledFlush = () => {

			this.flushScheduled = false;
			this.flush();

		};

		this.installQueue( queue );
		this.installErrorScopes( device );
		this.installCreation( device );

	}

	installQueue( queue ) {

		const writeBuffer = queue.writeBuffer.bind( queue );
		const writeTexture = queue.writeTexture.bind( queue );
		const copyExternalImageToTexture = queue.copyExternalImageToTexture.bind( queue );
		const onSubmittedWorkDone = queue.onSubmittedWorkDone.bind( queue );

		queue.submit = ( commandBuffers ) => this.enqueue( commandBuffers );

		queue.writeBuffer = ( buffer, ...rest ) => {

			if ( this.referenced.has( buffer ) ) this.flush();
			return writeBuffer( buffer, ...rest );

		};

		queue.writeTexture = ( ...args ) => {

			this.flush();
			return writeTexture( ...args );

		};

		queue.copyExternalImageToTexture = ( ...args ) => {

			this.flush();
			return copyExternalImageToTexture( ...args );

		};

		queue.onSubmittedWorkDone = () => {

			this.flush();
			return onSubmittedWorkDone();

		};

	}

	installErrorScopes( device ) {

		device.pushErrorScope = ( filter ) => {

			this.scopes.push( { filter, objects: [] } );
			return this._pushErrorScope( filter );

		};

		device.popErrorScope = () => {

			const scope = this.scopes.pop();

			return this._popErrorScope().then( ( error ) => {

				if ( scope !== undefined ) this.settle( scope.objects, error );
				return error;

			} );

		};

	}

	installCreation( device ) {

		const createBindGroup = device.createBindGroup.bind( device );
		const createBuffer = device.createBuffer.bind( device );
		const createTexture = device.createTexture.bind( device );
		const createCommandEncoder = device.createCommandEncoder.bind( device );

		for ( const name of [ 'createRenderPipeline', 'createComputePipeline' ] ) {

			const create = device[ name ].bind( device );
			device[ name ] = ( descriptor ) => this.created( () => create( descriptor ) );

		}

		for ( const name of [ 'createRenderPipelineAsync', 'createComputePipelineAsync' ] ) {

			const create = device[ name ].bind( device );

			device[ name ] = ( descriptor ) => create( descriptor ).then( ( pipeline ) => {

				this.validity.set( pipeline, VALID );
				return pipeline;

			} );

		}

		device.createBindGroup = ( descriptor ) => {

			const bindGroup = this.created( () => createBindGroup( descriptor ) );
			const buffers = [];

			for ( const entry of descriptor.entries ) {

				const buffer = entry.resource && entry.resource.buffer;
				if ( buffer !== undefined ) buffers.push( buffer );

			}

			this.buffersOfGroup.set( bindGroup, buffers );

			return bindGroup;

		};

		device.createBuffer = ( descriptor ) => {

			const buffer = this.flushBeforeDestroy( this.created( () => createBuffer( descriptor ) ) );

			if ( ( descriptor.usage & ( GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE ) ) !== 0 ) {

				const mapAsync = buffer.mapAsync.bind( buffer );

				buffer.mapAsync = ( ...args ) => {

					this.flush();
					return mapAsync( ...args );

				};

			}

			return buffer;

		};

		device.createTexture = ( descriptor ) => {

			const texture = this.flushBeforeDestroy( this.created( () => createTexture( descriptor ) ) );
			const createView = texture.createView.bind( texture );

			texture.createView = ( ...args ) => {

				const view = createView( ...args );
				this.textureOfView.set( view, texture );
				return view;

			};

			return texture;

		};

		device.createCommandEncoder = ( descriptor ) => this.observeEncoder( createCommandEncoder( descriptor ) );

	}

	created( create ) {

		const scope = this.innermostValidationScope();

		if ( scope !== undefined ) {

			const object = create();
			this.validity.set( object, UNKNOWN );
			scope.objects.push( object );
			return object;

		}

		this._pushErrorScope( 'validation' );
		const object = create();
		this.validity.set( object, UNKNOWN );

		this._popErrorScope().then( ( error ) => {

			this.settle( [ object ], error );
			if ( error !== null ) console.error( `WebGPU: ${ error.message }` );

		} );

		return object;

	}

	innermostValidationScope() {

		for ( let i = this.scopes.length - 1; i >= 0; i -- ) {

			if ( this.scopes[ i ].filter === 'validation' ) return this.scopes[ i ];

		}

		return undefined;

	}

	settle( objects, error ) {

		for ( const object of objects ) this.validity.set( object, error === null ? VALID : INVALID );

	}

	flushBeforeDestroy( resource ) {

		const destroy = resource.destroy.bind( resource );

		resource.destroy = () => {

			if ( this.waiting.length > 0 ) this.flush();
			destroy();

		};

		return resource;

	}

	observeEncoder( encoder ) {

		const recording = { references: new Set(), uses: new Set() };
		const use = ( object ) => { if ( object ) recording.uses.add( object ); };
		const reference = ( buffer ) => { if ( buffer ) { recording.references.add( buffer ); recording.uses.add( buffer ); } };
		const useView = ( view ) => { if ( view ) use( this.textureOfView.get( view ) ); };

		after( encoder, 'beginComputePass', ( pass ) => this.observePass( pass, use, reference ) );

		after( encoder, 'beginRenderPass', ( pass, descriptor ) => {

			for ( const attachment of descriptor.colorAttachments || [] ) {

				if ( attachment ) { useView( attachment.view ); useView( attachment.resolveTarget ); }

			}

			if ( descriptor.depthStencilAttachment ) useView( descriptor.depthStencilAttachment.view );

			return this.observePass( pass, use, reference );

		} );

		after( encoder, 'copyBufferToBuffer', ( result, source, sourceOffset, destination ) => {

			reference( source );
			reference( typeof sourceOffset === 'object' ? sourceOffset : destination );
			return result;

		} );

		after( encoder, 'copyBufferToTexture', ( result, source, destination ) => { reference( source.buffer ); use( destination.texture ); return result; } );
		after( encoder, 'copyTextureToBuffer', ( result, source, destination ) => { use( source.texture ); reference( destination.buffer ); return result; } );
		after( encoder, 'copyTextureToTexture', ( result, source, destination ) => { use( source.texture ); use( destination.texture ); return result; } );
		after( encoder, 'clearBuffer', ( result, buffer ) => { reference( buffer ); return result; } );
		after( encoder, 'resolveQuerySet', ( result, querySet, firstQuery, queryCount, destination ) => { reference( destination ); return result; } );

		after( encoder, 'finish', ( commandBuffer ) => {

			this.recordings.set( commandBuffer, recording );
			return commandBuffer;

		} );

		return encoder;

	}

	observePass( pass, use, reference ) {

		after( pass, 'setPipeline', ( result, pipeline ) => { use( pipeline ); return result; } );

		after( pass, 'setBindGroup', ( result, index, bindGroup ) => {

			use( bindGroup );
			for ( const buffer of this.buffersOfGroup.get( bindGroup ) || [] ) reference( buffer );
			return result;

		} );

		after( pass, 'setVertexBuffer', ( result, slot, buffer ) => { reference( buffer ); return result; } );
		after( pass, 'setIndexBuffer', ( result, buffer ) => { reference( buffer ); return result; } );
		after( pass, 'dispatchWorkgroupsIndirect', ( result, buffer ) => { reference( buffer ); return result; } );
		after( pass, 'drawIndirect', ( result, buffer ) => { reference( buffer ); return result; } );
		after( pass, 'drawIndexedIndirect', ( result, buffer ) => { reference( buffer ); return result; } );

		after( pass, 'executeBundles', ( result, bundles ) => {

			for ( const bundle of bundles ) use( bundle );
			return result;

		} );

		return pass;

	}

	enqueue( commandBuffers ) {

		for ( const commandBuffer of commandBuffers ) {

			const recording = this.recordings.get( commandBuffer );

			if ( recording !== undefined ) {

				for ( const buffer of recording.references ) this.referenced.add( buffer );

			}

			this.waiting.push( { commandBuffer, uses: recording === undefined ? null : recording.uses } );

		}

		if ( this.flushScheduled === false ) {

			this.flushScheduled = true;
			queueMicrotask( this._scheduledFlush );

		}

	}

	isTrusted( uses ) {

		if ( uses === null ) return true;

		for ( const object of uses ) {

			const validity = this.validity.get( object );
			if ( validity !== undefined && validity !== VALID ) return false;

		}

		return true;

	}

	flush() {

		const waiting = this.waiting;
		this.waiting = [];
		this.referenced.clear();

		let batch = [];

		for ( const { commandBuffer, uses } of waiting ) {

			if ( this.batching && this.isTrusted( uses ) ) {

				batch.push( commandBuffer );
				continue;

			}

			if ( batch.length > 0 ) this.submitNow( batch );
			this.submitNow( [ commandBuffer ] );
			batch = [];

		}

		if ( batch.length > 0 ) this.submitNow( batch );

	}

	submitNow( commandBuffers ) {

		this.submits ++;

		if ( commandBuffers.length === 1 ) {

			this._submit( commandBuffers );
			return;

		}

		this._pushErrorScope( 'validation' );
		this._submit( commandBuffers );

		this._popErrorScope().then( ( error ) => {

			if ( error === null || this.batching === false ) return;

			this.batching = false;
			console.error( `WebGPU: a batched submit of ${ commandBuffers.length } command buffers was rejected (${ error.message }); every command buffer is submitted on its own from now on, so an invalid one loses only itself.` );

		} );

	}

}

function after( target, name, observe ) {

	const original = target[ name ];

	if ( typeof original !== 'function' ) return;

	target[ name ] = ( ...args ) => observe( original.apply( target, args ), ...args );

}

export default WebGPUCommandQueue;
