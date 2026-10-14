import { touchMaterials } from './DrawListRevision.js';

const _watchers = new WeakMap();
const _materialVersions = new WeakMap();

export function signalSource( source ) {

	if ( source.isMaterial === true && _materialVersions.get( source ) !== source.version ) {

		_materialVersions.set( source, source.version );
		touchMaterials();

	}

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
