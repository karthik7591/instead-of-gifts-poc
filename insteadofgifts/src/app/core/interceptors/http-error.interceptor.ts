import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../services/toast.service';

/**
 * Maps HTTP status codes to user-friendly toast messages.
 * Returns null for statuses that should be handled silently
 * (e.g. 404 which the calling code typically handles explicitly).
 */
function toastMessageForStatus(status: number, url: string): string | null {
  // Ignore auth-callback and Supabase GoTrue endpoints — they surface
  // their own errors through the auth flow.
  if (url.includes('/auth/v1/') || url.includes('/auth/callback')) return null;

  switch (true) {
    case status === 0:
      return 'Network error — please check your connection.';
    case status === 401:
      return 'Your session has expired — please sign in again.';
    case status === 403:
      return 'You don\'t have permission to perform this action.';
    case status === 404:
      // Callers handle 404 explicitly (e.g. "Campaign not found")
      return null;
    case status === 429:
      return 'Too many requests — please wait a moment and try again.';
    case status >= 500:
      return 'Something went wrong on our end — please try again.';
    default:
      return null;
  }
}

/**
 * Global HTTP error interceptor.
 * Catches 4xx / 5xx responses from Angular's HttpClient and shows a toast.
 * Re-throws the error so callers can still react to it.
 *
 * Note: Supabase JS client uses native fetch (not HttpClient), so Supabase
 * errors are handled at the service level via ToastService directly.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastSvc = inject(ToastService);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const message = toastMessageForStatus(err.status, req.url);
        if (message) {
          toastSvc.error(message);
        }
      }
      return throwError(() => err);
    }),
  );
};
