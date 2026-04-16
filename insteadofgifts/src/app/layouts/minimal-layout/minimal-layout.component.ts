import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteHeaderComponent } from '../../shared/components/site-header/site-header.component';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer.component';

@Component({
  selector: 'app-minimal-layout',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './minimal-layout.component.html',
  styleUrl: './minimal-layout.component.scss'
})
export class MinimalLayoutComponent {

}
