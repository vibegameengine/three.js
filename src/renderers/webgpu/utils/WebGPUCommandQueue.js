export const CLEAN_FINISHES_TO_TRUST = 60;
const REPEATED_FAILURE_REPORT = 300;
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
 * also be invalid from how it was encoded, which WebGPU reports at finish(): the first batch
 * holding it is lost, its label is marked broken and later command buffers with that label
 * go out on their own until the label has encoded cleanly CLEAN_FINISHES_TO_TRUST times. A
 * render context or compute node label names one pass; 'clear', 'mipmapEncoder' and the
 * empty label are shared, so one broken encoder isolates all of them, which costs batching
 * and nothing else. Inside someone else's validation scope finish() opens no scope of its
 * own: the owner gets the error and the queue reads it when the scope is popped. A rejected
 * batch in which no encoder reported an error makes every later command buffer go out on
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
		this.bundleContents = new WeakMap();
		this.recordings = new WeakMap();
		this.scopes = [];
		this.brokenLabels = new Set();
		this.cleanFinishes = new Map();
		this.encoderFailures = new Map();
		this.opaqueWaiting = false;
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

			if ( this.opaqueWaiting || this.referenced.has( buffer ) ) this.flush();
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

			this.scopes.push( { filter, objects: [], labels: [] } );
			return this._pushErrorScope( filter );

		};

		device.popErrorScope = () => {

			const scope = this.scopes.pop();

			return this._popErrorScope().then( ( error ) => {

				if ( scope !== undefined ) {

					this.settle( scope.objects, error );
					for ( const label of scope.labels ) this.settleEncoder( label, error );

				}

				return error;

			} );

		};

	}

	installCreation( device ) {

		const createQuerySet = device.createQuerySet.bind( device );

		device.createQuerySet = ( descriptor ) => this.flushBeforeDestroy( createQuerySet( descriptor ) );

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

		device.createCommandEncoder = ( descriptor ) => this.observeEncoder( createCommandEncoder( descriptor ), descriptor && descriptor.label ? descriptor.label : '' );

		const createRenderBundleEncoder = device.createRenderBundleEncoder.bind( device );

		device.createRenderBundleEncoder = ( descriptor ) => this.observeBundleEncoder( createRenderBundleEncoder( descriptor ) );

	}

	observeBundleEncoder( encoder ) {

		const references = new Set();
		const contents = { referenced: null, uses: new Set(), trusted: false };
		const use = ( object ) => { if ( object ) contents.uses.add( object ); };
		const reference = ( buffer ) => { if ( buffer ) { references.add( buffer ); contents.uses.add( buffer ); } };

		const setPipeline = encoder.setPipeline.bind( encoder );
		const setBindGroup = encoder.setBindGroup.bind( encoder );
		const setVertexBuffer = encoder.setVertexBuffer.bind( encoder );
		const setIndexBuffer = encoder.setIndexBuffer.bind( encoder );
		const drawIndirect = encoder.drawIndirect.bind( encoder );
		const drawIndexedIndirect = encoder.drawIndexedIndirect.bind( encoder );
		const finish = encoder.finish.bind( encoder );

		encoder.setPipeline = ( pipeline ) => { use( pipeline ); setPipeline( pipeline ); };
		encoder.setBindGroup = ( index, bindGroup, ...rest ) => {

			if ( bindGroup ) {

				use( bindGroup );
				for ( const buffer of this.buffersOfGroup.get( bindGroup ) || [] ) references.add( buffer );

			}

			setBindGroup( index, bindGroup, ...rest );

		};
		encoder.setVertexBuffer = ( slot, buffer, offset, size ) => { reference( buffer ); setVertexBuffer( slot, buffer, offset, size ); };
		encoder.setIndexBuffer = ( buffer, format, offset, size ) => { reference( buffer ); setIndexBuffer( buffer, format, offset, size ); };
		encoder.drawIndirect = ( buffer, offset ) => { reference( buffer ); drawIndirect( buffer, offset ); };
		encoder.drawIndexedIndirect = ( buffer, offset ) => { reference( buffer ); drawIndexedIndirect( buffer, offset ); };

		encoder.finish = ( descriptor ) => {

			const bundle = descriptor === undefined ? finish() : finish( descriptor );
			contents.referenced = [ ...references ];
			this.bundleContents.set( bundle, contents );
			return bundle;

		};

		return encoder;

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

	settleEncoder( label, error ) {

		if ( error !== null ) {

			const failures = ( this.encoderFailures.get( label ) || 0 ) + 1;
			this.encoderFailures.set( label, failures );
			this.cleanFinishes.delete( label );

			if ( this.brokenLabels.has( label ) === false ) {

				this.brokenLabels.add( label );
				console.error( `WebGPU: command encoder "${ label }" is invalid (${ error.message }); its command buffers are submitted on their own until it encodes cleanly ${ CLEAN_FINISHES_TO_TRUST } times.` );

			} else if ( failures % REPEATED_FAILURE_REPORT === 0 ) {

				console.error( `WebGPU: command encoder "${ label }" is still invalid, ${ failures } times (${ error.message }).` );

			}

			return;

		}

		if ( this.brokenLabels.has( label ) === false ) return;

		const clean = ( this.cleanFinishes.get( label ) || 0 ) + 1;
		this.cleanFinishes.set( label, clean );

		if ( clean < CLEAN_FINISHES_TO_TRUST ) return;

		this.brokenLabels.delete( label );
		this.cleanFinishes.delete( label );
		this.encoderFailures.delete( label );
		console.info( `WebGPU: command encoder "${ label }" encoded cleanly ${ clean } times and is batched again.` );

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

	observeEncoder( encoder, label ) {

		const recording = { references: new Set(), uses: new Set(), groups: new Set(), bundles: [], opaque: false, label };
		const use = ( object ) => { if ( object ) recording.uses.add( object ); };
		const reference = ( buffer ) => { if ( buffer ) { recording.references.add( buffer ); recording.uses.add( buffer ); } };
		const useView = ( view ) => { if ( view ) use( this.textureOfView.get( view ) ); };

		after( encoder, 'beginComputePass', ( pass ) => this.observePass( pass, false, recording, use, reference ) );

		after( encoder, 'beginRenderPass', ( pass, descriptor ) => {

			for ( const attachment of descriptor.colorAttachments || [] ) {

				if ( attachment ) { useView( attachment.view ); useView( attachment.resolveTarget ); }

			}

			if ( descriptor.depthStencilAttachment ) useView( descriptor.depthStencilAttachment.view );

			return this.observePass( pass, true, recording, use, reference );

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

		const finish = encoder.finish.bind( encoder );

		encoder.finish = ( descriptor ) => {

			const scope = this.innermostValidationScope();
			let commandBuffer;

			if ( scope !== undefined ) {

				commandBuffer = descriptor === undefined ? finish() : finish( descriptor );
				scope.labels.push( label );

			} else {

				this._pushErrorScope( 'validation' );
				commandBuffer = descriptor === undefined ? finish() : finish( descriptor );
				this._popErrorScope().then( ( error ) => this.settleEncoder( label, error ) );

			}

			this.recordings.set( commandBuffer, recording );
			return commandBuffer;

		};

		return encoder;

	}

	observePass( pass, isRenderPass, recording, use, reference ) {

		const setPipeline = pass.setPipeline.bind( pass );
		const setBindGroup = pass.setBindGroup.bind( pass );

		pass.setPipeline = ( pipeline ) => {

			use( pipeline );
			setPipeline( pipeline );

		};

		pass.setBindGroup = ( index, bindGroup, dynamicOffsets, start, length ) => {

			if ( bindGroup ) recording.groups.add( bindGroup );

			if ( dynamicOffsets === undefined ) setBindGroup( index, bindGroup );
			else if ( start === undefined ) setBindGroup( index, bindGroup, dynamicOffsets );
			else setBindGroup( index, bindGroup, dynamicOffsets, start, length );

		};

		if ( isRenderPass ) {

			const setVertexBuffer = pass.setVertexBuffer.bind( pass );
			const setIndexBuffer = pass.setIndexBuffer.bind( pass );
			const drawIndirect = pass.drawIndirect.bind( pass );
			const drawIndexedIndirect = pass.drawIndexedIndirect.bind( pass );
			const executeBundles = pass.executeBundles.bind( pass );

			pass.setVertexBuffer = ( slot, buffer, offset, size ) => { reference( buffer ); setVertexBuffer( slot, buffer, offset, size ); };
			pass.setIndexBuffer = ( buffer, format, offset, size ) => { reference( buffer ); setIndexBuffer( buffer, format, offset, size ); };
			pass.drawIndirect = ( buffer, offset ) => { reference( buffer ); drawIndirect( buffer, offset ); };
			pass.drawIndexedIndirect = ( buffer, offset ) => { reference( buffer ); drawIndexedIndirect( buffer, offset ); };

			pass.executeBundles = ( bundles ) => {

				for ( const bundle of bundles ) {

					const contents = this.bundleContents.get( bundle );

					if ( contents === undefined ) {

						use( bundle );
						recording.opaque = true;
						continue;

					}

					recording.bundles.push( contents );

					if ( contents.trusted === false ) {

						contents.trusted = this.allValid( contents.uses );
						if ( contents.trusted === false ) for ( const object of contents.uses ) recording.uses.add( object );

					}

				}

				executeBundles( bundles );

			};

		} else {

			const dispatchWorkgroupsIndirect = pass.dispatchWorkgroupsIndirect.bind( pass );

			pass.dispatchWorkgroupsIndirect = ( buffer, offset ) => { reference( buffer ); dispatchWorkgroupsIndirect( buffer, offset ); };

		}

		return pass;

	}

	enqueue( commandBuffers ) {

		for ( const commandBuffer of commandBuffers ) {

			const recording = this.recordings.get( commandBuffer );

			if ( recording !== undefined ) {

				for ( const buffer of recording.references ) this.referenced.add( buffer );

				for ( const contents of recording.bundles ) {

					const referenced = contents.referenced;
					for ( let i = 0, l = referenced.length; i < l; i ++ ) this.referenced.add( referenced[ i ] );

				}

				for ( const bindGroup of recording.groups ) {

					recording.uses.add( bindGroup );
					for ( const buffer of this.buffersOfGroup.get( bindGroup ) || [] ) this.referenced.add( buffer );

				}

				if ( recording.opaque ) this.opaqueWaiting = true;

			}

			this.waiting.push( { commandBuffer, uses: recording === undefined ? null : recording.uses, label: recording === undefined ? '' : recording.label } );

		}

		if ( this.flushScheduled === false ) {

			this.flushScheduled = true;
			queueMicrotask( this._scheduledFlush );

		}

	}

	isTrusted( uses, label ) {

		if ( this.brokenLabels.has( label ) ) return false;
		if ( uses === null ) return true;

		return this.allValid( uses );

	}

	allValid( objects ) {

		for ( const object of objects ) {

			const validity = this.validity.get( object );
			if ( validity !== undefined && validity !== VALID ) return false;

		}

		return true;

	}

	flush() {

		const waiting = this.waiting;
		this.waiting = [];
		this.referenced.clear();
		this.opaqueWaiting = false;

		let batch = [];

		for ( const entry of waiting ) {

			if ( this.batching && this.isTrusted( entry.uses, entry.label ) ) {

				batch.push( entry );
				continue;

			}

			if ( batch.length > 0 ) this.submitNow( batch );
			this.submitNow( [ entry ] );
			batch = [];

		}

		if ( batch.length > 0 ) this.submitNow( batch );

	}

	submitNow( entries ) {

		const commandBuffers = entries.map( ( entry ) => entry.commandBuffer );

		this.submits ++;

		if ( entries.length === 1 ) {

			this._submit( commandBuffers );
			return;

		}

		this._pushErrorScope( 'validation' );
		this._submit( commandBuffers );

		this._popErrorScope().then( ( error ) => {

			if ( error === null || this.batching === false ) return;
			if ( entries.some( ( entry ) => this.brokenLabels.has( entry.label ) ) ) return;

			this.batching = false;
			console.error( `WebGPU: a batched submit of ${ entries.length } command buffers was rejected (${ error.message }) and no encoder in it reported an error; every command buffer is submitted on its own from now on, so an invalid one loses only itself.` );

		} );

	}

}

function after( target, name, observe ) {

	const original = target[ name ];

	if ( typeof original !== 'function' ) return;

	target[ name ] = ( ...args ) => observe( original.apply( target, args ), ...args );

}

export default WebGPUCommandQueue;
