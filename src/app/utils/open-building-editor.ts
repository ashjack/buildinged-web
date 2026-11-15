import { Router } from '@angular/router';

/** Open synchronously from the click so the map stays open and popup blocking is avoided. */
export function openBuildingEditor(router: Router, projectId: string, path: string, copy = false): void {
    const url = router.createUrlTree(copy ? ['/projects', projectId, 'world-buildings', 'new']
        : ['/projects', projectId, 'world-buildings', path, 'edit'], copy ? { queryParams: { copyFrom: path, openEditor: 'true' } } : {});
    window.open(router.serializeUrl(url), '_blank', 'noopener');
}
