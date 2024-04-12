import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";

@Injectable({
    providedIn: 'root',
})
export class ApiService {
    private baseUrl = 'https://us-central1-buildinged-online.cloudfunctions.net'; // Replace 'YOUR_BASE_URL' with the actual base URL
    constructor(private http: HttpClient) { }

    // Function to get all buildings by project name from the API
    async getBuildingsByProjectName(projectName: string) {
         return this.http.get<any>(`${this.baseUrl}/getbuildingsbyproject?project=${projectName}`).toPromise();
    }
}