const _watchers = new WeakMap();

export function signalSource( source ) {

	const watchers = _watchers.get( source );

	if ( watchers === undefined ) return;

	for ( const watcher of watchers ) watcher.sourcesChanged = true;

}

export function watchSource( source, watcher ) {

	if ( source === null || source === undefined || typeof source !== 'object' ) return;

	let watchers = _watchers.get( source );

	if ( watchers === undefined ) _watchers.set( source, watchers = new Set() );

	watchers.add( watcher );

}

export function unwatchSource( source, watcher ) {

	if ( source === null || source === undefined || typeof source !== 'object' ) return;

	const watchers = _watchers.get( source );

	if ( watchers !== undefined ) watchers.delete( watcher );

}
