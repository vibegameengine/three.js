/**
 * Collects the command buffers of a frame and submits them together, instead of one
 * `GPUQueue.submit` per pass.
 *
 * It installs itself on the device, so every caller goes through it, three's own code or
 * not. `queue.writeBuffer` is ordered against submits, not against command buffers still
 * waiting here, so a write into a buffer that a waiting command buffer references submits
 * the waiting ones first; every write therefore lands where it did when each pass was
 * submitted on its own. The buffers of a pass still being recorded are kept apart until
 * its command buffer arrives, because a write into those landed before the pass then too.
 * Destroying a buffer or texture submits first, since a submit that references a destroyed
 * resource is rejected whole, with every pass in it. Texture writes, external image copies, `onSubmittedWorkDone` and
 * the mapping of a readable buffer submit first as well. Whatever is still waiting when
 * the current task ends is submitted from a microtask, before the browser presents.
 */
class WebGPUCommandQueue {

	/**
	 * @param {GPUDevice} device - The device whose queue is batched.
	 */
	constructor( device ) {

		this.device = device;
		this.waiting = [];
		this.referenced = new Set();
		this.recording = new Set();
		this.buffersOfGroup = new WeakMap();
		this.flushScheduled = false;
		this.submits = 0;

		const queue = device.queue;
		const submit = queue.submit.bind( queue );
		const writeBuffer = queue.writeBuffer.bind( queue );
		const writeTexture = queue.writeTexture.bind( queue );
		const copyExternalImageToTexture = queue.copyExternalImageToTexture.bind( queue );
		const onSubmittedWorkDone = queue.onSubmittedWorkDone.bind( queue );
		const createBindGroup = device.createBindGroup.bind( device );
		const createBuffer = device.createBuffer.bind( device );
		const createTexture = device.createTexture.bind( device );

		this._submit = submit;

		this._scheduledFlush = () => {

			this.flushScheduled = false;
			this.flush();

		};

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

		device.createBindGroup = ( descriptor ) => {

			const bindGroup = createBindGroup( descriptor );
			const buffers = [];

			for ( const entry of descriptor.entries ) {

				const buffer = entry.resource && entry.resource.buffer;
				if ( buffer !== undefined ) buffers.push( buffer );

			}

			this.buffersOfGroup.set( bindGroup, buffers );

			return bindGroup;

		};

		device.createBuffer = ( descriptor ) => {

			const buffer = this.flushBeforeDestroy( createBuffer( descriptor ) );

			if ( ( descriptor.usage & ( GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE ) ) !== 0 ) {

				const mapAsync = buffer.mapAsync.bind( buffer );

				buffer.mapAsync = ( ...args ) => {

					this.flush();
					return mapAsync( ...args );

				};

			}

			return buffer;

		};

		device.createTexture = ( descriptor ) => this.flushBeforeDestroy( createTexture( descriptor ) );

	}

	flushBeforeDestroy( resource ) {

		const destroy = resource.destroy.bind( resource );

		resource.destroy = () => {

			if ( this.waiting.length > 0 ) this.flush();
			destroy();

		};

		return resource;

	}

	useBindGroup( bindGroup ) {

		const buffers = this.buffersOfGroup.get( bindGroup );

		if ( buffers === undefined ) return;

		for ( const buffer of buffers ) this.recording.add( buffer );

	}

	useBuffer( buffer ) {

		this.recording.add( buffer );

	}

	enqueue( commandBuffers ) {

		for ( const commandBuffer of commandBuffers ) this.waiting.push( commandBuffer );
		for ( const buffer of this.recording ) this.referenced.add( buffer );
		this.recording.clear();

		if ( this.flushScheduled === false ) {

			this.flushScheduled = true;
			queueMicrotask( this._scheduledFlush );

		}

	}

	flush() {

		if ( this.waiting.length > 0 ) {

			const waiting = this.waiting;
			this.waiting = [];
			this._submit( waiting );
			this.submits ++;

		}

		this.referenced.clear();

	}

}

export default WebGPUCommandQueue;
