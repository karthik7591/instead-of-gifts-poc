import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header.component';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer.component';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent {

}
