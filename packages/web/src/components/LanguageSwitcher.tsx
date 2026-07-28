import { useTranslation } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * Language toggle.
 *
 * Both buttons were 16px tall — a real control, on a phone, at a third of the
 * minimum comfortable tap size. The active choice was also signalled by font
 * weight alone, which is a contrast-only cue, and neither button told assistive
 * tech what it would do or which one was selected.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
	const { locale, setLocale, t } = useTranslation();

	const option = (active: boolean) =>
		cn(
			'flex min-h-11 items-center rounded px-2 text-xs transition-colors',
			active
				? 'font-semibold text-foreground'
				: 'text-muted-foreground hover:text-foreground',
		);

	return (
		<div
			role="group"
			aria-label={t('nav.language')}
			className={cn('flex items-center', className)}
		>
			<button
				type="button"
				onClick={() => setLocale('en')}
				// aria-pressed rather than colour alone, so the current choice is
				// actually announced.
				aria-pressed={locale === 'en'}
				lang="en"
				className={option(locale === 'en')}
			>
				EN
			</button>
			<span aria-hidden="true" className="text-xs text-muted-foreground">
				/
			</span>
			<button
				type="button"
				onClick={() => setLocale('ja')}
				aria-pressed={locale === 'ja'}
				lang="ja"
				className={option(locale === 'ja')}
			>
				日本語
			</button>
		</div>
	);
}
