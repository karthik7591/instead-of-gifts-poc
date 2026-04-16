import { Component, ChangeDetectionStrategy, computed, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ProService } from '../../../core/services/pro.service';

@Component({
  selector: 'app-site-header',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './site-header.component.html',
  styleUrl: './site-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeaderComponent {
  private readonly authSvc = inject(AuthService);
  private readonly proSvc = inject(ProService);
  private readonly hostEl = inject(ElementRef<HTMLElement>);

  @ViewChild('profileDropdown') private profileDropdown?: ElementRef<HTMLDetailsElement>;

  protected readonly user = this.authSvc.user;
  protected readonly campaignCredits = this.proSvc.campaignCredits;
  protected readonly displayName = computed(() => {
    const user = this.user();
    if (!user) return '';

    const metadataName =
      user.user_metadata?.['full_name'] ??
      user.user_metadata?.['name'] ??
      user.user_metadata?.['first_name'];

    return typeof metadataName === 'string' && metadataName.trim().length
      ? metadataName.trim()
      : user.email ?? 'Account';
  });
  protected readonly initials = computed(() => {
    const label = this.displayName();
    if (!label) return 'A';

    const parts = label
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    return (parts[0]?.[0] ?? 'A') + (parts[1]?.[0] ?? '');
  });

  protected closeDropdown(dropdown: HTMLDetailsElement): void {
    dropdown.open = false;
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const dropdown = this.profileDropdown?.nativeElement;
    if (!dropdown?.open) return;

    const target = event.target;
    if (target instanceof Node && !this.hostEl.nativeElement.contains(target)) {
      dropdown.open = false;
    }
  }

  protected async onLogout(): Promise<void> {
    await this.authSvc.signOut();
  }
}
