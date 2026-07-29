import { useTranslation } from '../lib/i18n';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
	const { locale, setLocale } = useTranslation();

	return (
		<div className={`flex items-center gap-1.5 text-xs ${className}`}>
			<button
				type="button"
				onClick={() => setLocale('en')}
				className={
					locale === 'en'
						? 'font-semibold'
						: 'text-muted-foreground hover:text-foreground transition-colors'
				}
			>
				EN
			</button>
			<span className="text-muted-foreground">/</span>
			<button
				type="button"
				onClick={() => setLocale('ja')}
				className={
					locale === 'ja'
						? 'font-semibold'
						: 'text-muted-foreground hover:text-foreground transition-colors'
				}
			>
				日本語
			</button>
		</div>
	);
}
