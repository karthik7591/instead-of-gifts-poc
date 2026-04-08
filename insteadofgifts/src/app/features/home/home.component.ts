import {
  Component,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucidePencilLine,
  lucideShare2,
  lucideGift,
  lucideCheck,
  lucideX,
  lucideChevronDown,
  lucideStar,
  lucideUsers,
  lucideHeart,
  lucideCake,
  lucideTrees,
  lucideGraduationCap,
  lucidePalmtree,
} from '@ng-icons/lucide';
import { ButtonComponent } from '../../shared/components/button/button.component';

export interface Step {
  icon:  string;
  step:  string;
  title: string;
  body:  string;
}

export interface PricingFeature {
  label:    string;
  /** null = not included; '' = included; non-empty string = included with note */
  freeNote: string | null;
  /** '' = included; non-empty string = included with note */
  proNote:  string;
}

export interface Occasion {
  icon:  string;
  label: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ButtonComponent, NgIconComponent],
  providers: [
    provideIcons({
      lucidePencilLine,
      lucideShare2,
      lucideGift,
      lucideCheck,
      lucideX,
      lucideChevronDown,
      lucideStar,
      lucideUsers,
      lucideHeart,
      lucideCake,
      lucideTrees,
      lucideGraduationCap,
      lucidePalmtree,
    }),
  ],
  templateUrl: './home.component.html',
  styleUrl:    './home.component.scss',
})
export class HomeComponent {

  readonly steps: Step[] = [
    {
      icon:  'lucidePencilLine',
      step:  '01',
      title: 'Create a campaign',
      body:  'Set a goal, write a personal message, and choose a deadline. Ready in under two minutes.',
    },
    {
      icon:  'lucideShare2',
      step:  '02',
      title: 'Share the link',
      body:  'Send it by WhatsApp, email, or social media. Anyone with the link can contribute — no account needed.',
    },
    {
      icon:  'lucideGift',
      step:  '03',
      title: 'Collect contributions',
      body:  'Watch contributions roll in and withdraw to your bank whenever you\'re ready.',
    },
  ];

  readonly occasions: Occasion[] = [
    { icon: 'lucideCake',           label: 'Birthdays'  },
    { icon: 'lucideTrees',          label: 'Holidays'   },
    { icon: 'lucideGraduationCap',  label: 'Graduation' },
    { icon: 'lucidePalmtree',       label: 'Retirement' },
  ];

  readonly pricingFeatures: PricingFeature[] = [
    { label: 'Campaign Pro upgrade',       freeNote: null,       proNote: '$9.99 each'  },
    { label: 'Shareable campaign link',    freeNote: '',         proNote: ''           },
    { label: 'Contribution tracking',      freeNote: '',         proNote: ''           },
    { label: 'Cover photos',               freeNote: null,       proNote: ''           },
    { label: 'Custom thank-you message',   freeNote: null,       proNote: ''           },
    { label: 'QR code sharing',            freeNote: null,       proNote: ''           },
    { label: 'Priority support',           freeNote: null,       proNote: ''           },
  ];

  readonly year = new Date().getFullYear();

  readonly stats = [
    { value: '500+',    label: 'Campaigns created'       },
    { value: '$120k+',  label: 'Contributions collected' },
    { value: '1,000+',  label: 'Happy contributors'      },
  ];

  freeIncluded(f: PricingFeature): boolean {
    return f.freeNote !== null;
  }

  freeLabel(f: PricingFeature): string {
    return f.freeNote ? `${f.label} (${f.freeNote})` : f.label;
  }

  proLabel(f: PricingFeature): string {
    return f.proNote ? `${f.label} (${f.proNote})` : f.label;
  }
}
