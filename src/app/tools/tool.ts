import { ViewportComponent } from "../viewport/viewport.component";

export default abstract class Tool{
    hoverColor: string = 'red';
    dragColor: string = 'blue';
    key: string = '';

    grid: ViewportComponent;

    constructor(grid: ViewportComponent) {
        this.grid = grid;
    }


    
}