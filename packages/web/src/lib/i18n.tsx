import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

export type Locale = 'en' | 'ja';

const LOCALE_KEY = 'tracking-link.locale';

type Dictionary = Record<string, string>;

const en: Dictionary = {
	'common.loading': 'Loading…',
	'common.totalCount': '{total} total',
	'common.cancel': 'Cancel',
	'common.add': 'Add',
	'common.save': 'Save',
	'common.show': 'Show',
	'common.edit': 'Edit',
	'common.delete': 'Delete',
	'common.close': 'Close',
	'common.name': 'Name',
	'common.destinationUrl': 'Destination URL',
	'common.scans': 'Scans',
	'common.qrCodeCount': 'QR codes',
	'common.created': 'Created',
	'common.actions': 'Actions',
	'common.location': 'Location',
	'common.time': 'Time',
	'common.qrId': 'QR ID',
	'common.ip': 'IP',
	'common.backToProjects': 'Back to projects',
	'common.genericError': 'Something went wrong',

	'login.subtitle': 'Sign in with the admin password.',
	'login.passwordLabel': 'Password',
	'login.signIn': 'Sign in',
	'login.signingIn': 'Signing in…',
	'login.failed': 'Login failed',
	'login.invalidPassword': 'Invalid password',

	'nav.projects': 'Projects',
	'nav.newProject': 'New project',
	'nav.logOut': 'Log out',

	'permission.noAccessTitle': "You don't have access to this page.",
	'permission.noAccessDesc':
		'Contact an administrator if you believe this is a mistake.',

	'pagination.range': '{start}–{end} of {total}',

	'projects.heading': 'TrackingLink',
	'projects.cardTitle': 'Projects',
	'projects.empty': 'No projects yet.',
	'projects.qrCodesLink': 'QR codes',
	'projects.csvDownloadLink': 'Download CSV',
	'projects.editFormTitle': 'Edit project',
	'projects.editFailed': 'Failed to update the project',
	'projects.deleteConfirm':
		'Delete this project? All of its QR codes will be deleted too.',
	'projects.deleteFailed': 'Failed to delete the project',

	'createProject.heading': 'New project',
	'createProject.subtitle': 'Create a new TrackingLink project',
	'createProject.nameLabel': 'Project name',
	'createProject.namePlaceholder': 'e.g. Flyer campaign',
	'createProject.urlLabel': 'Destination URL',
	'createProject.urlPlaceholder': 'https://example.com',
	'createProject.creating': 'Creating…',
	'createProject.submit': 'Create project',

	'qrCodes.heading': 'QR codes',
	'qrCodes.projectLabel': 'Project: {name}',
	'qrCodes.newButton': 'New QR code',
	'qrCodes.newFormTitle': 'New QR code',
	'qrCodes.editFormTitle': 'Edit QR code',
	'qrCodes.nameLabel': 'Name',
	'qrCodes.namePlaceholder': 'e.g. Poster by Design Dept.',
	'qrCodes.mediumLabel': 'Medium',
	'qrCodes.mediumPlaceholder': 'e.g. Instagram, Poster',
	'qrCodes.locationLabel': 'Location',
	'qrCodes.locationPlaceholder': 'e.g. 1F bulletin board, or a source post URL',
	'qrCodes.cardTitle': 'QR codes',
	'qrCodes.empty': 'No QR codes yet.',
	'qrCodes.showButton': 'Show QR',
	'qrCodes.deleteConfirm':
		'Delete this QR code? Its scan history will be deleted too.',
	'qrCodes.createFailed': 'Failed to create the QR code',
	'qrCodes.editFailed': 'Failed to update the QR code',
	'qrCodes.deleteFailed': 'Failed to delete',
	'qrCodes.qrIdHeader': 'QR ID',
	'qrCodes.dialogTitle': 'QR code',
	'qrCodes.generateFailed': 'Failed to generate the QR code',
	'qrCodes.downloadButton': 'Download PNG',

	'csvExport.downloadFailed': 'Failed to download the CSV',
	'csvExport.disabled': 'CSV export is not enabled yet',
};

const ja: Dictionary = {
	'common.loading': '読み込み中…',
	'common.totalCount': '全 {total} 件',
	'common.cancel': 'キャンセル',
	'common.add': '追加',
	'common.save': '保存',
	'common.show': '表示',
	'common.edit': '編集',
	'common.delete': '削除',
	'common.close': '閉じる',
	'common.name': '名前',
	'common.destinationUrl': '転送先URL',
	'common.scans': 'アクセス数',
	'common.qrCodeCount': 'QRコード数',
	'common.created': '作成日時',
	'common.actions': '操作',
	'common.location': '場所',
	'common.time': '日時',
	'common.qrId': 'QR ID',
	'common.ip': 'IPアドレス',
	'common.backToProjects': 'プロジェクト一覧に戻る',
	'common.genericError': 'エラーが発生しました',

	'login.subtitle': '管理者パスワードでログインしてください。',
	'login.passwordLabel': 'パスワード',
	'login.signIn': 'ログイン',
	'login.signingIn': 'ログイン中…',
	'login.failed': 'ログインに失敗しました',
	'login.invalidPassword': 'パスワードが正しくありません',

	'nav.projects': 'プロジェクト',
	'nav.newProject': 'プロジェクト作成',
	'nav.logOut': 'ログアウト',

	'permission.noAccessTitle': 'このページへのアクセス権限がありません。',
	'permission.noAccessDesc':
		'心当たりがない場合は管理者にお問い合わせください。',

	'pagination.range': '{start}〜{end} 件（全 {total} 件）',

	'projects.heading': 'TrackingLink',
	'projects.cardTitle': 'プロジェクト一覧',
	'projects.empty': 'プロジェクトがありません。',
	'projects.qrCodesLink': 'QRコード',
	'projects.csvDownloadLink': 'CSVダウンロード',
	'projects.editFormTitle': 'プロジェクトを編集',
	'projects.editFailed': 'プロジェクトの更新に失敗しました',
	'projects.deleteConfirm':
		'このプロジェクトを削除しますか？QRコードもすべて削除されます。',
	'projects.deleteFailed': 'プロジェクトの削除に失敗しました',

	'createProject.heading': 'プロジェクト作成',
	'createProject.subtitle': '新しいTrackingLinkプロジェクトを作成します。',
	'createProject.nameLabel': 'プロジェクト名',
	'createProject.namePlaceholder': '例：チラシキャンペーン',
	'createProject.urlLabel': '転送先URL',
	'createProject.urlPlaceholder': 'https://example.com',
	'createProject.creating': '作成中…',
	'createProject.submit': 'プロジェクトを作成',

	'qrCodes.heading': 'QRコード管理',
	'qrCodes.projectLabel': 'プロジェクト: {name}',
	'qrCodes.newButton': 'QRコード追加',
	'qrCodes.newFormTitle': '新規QRコード追加',
	'qrCodes.editFormTitle': 'QRコードを編集',
	'qrCodes.nameLabel': '名前',
	'qrCodes.namePlaceholder': '例：造形大ポスター',
	'qrCodes.mediumLabel': '媒体',
	'qrCodes.mediumPlaceholder': '例：Instagram、ポスター',
	'qrCodes.locationLabel': '場所',
	'qrCodes.locationPlaceholder': '例：1F掲示板、または投稿元のURL',
	'qrCodes.cardTitle': 'QRコード一覧',
	'qrCodes.empty': 'QRコードがありません。',
	'qrCodes.showButton': 'QR表示',
	'qrCodes.deleteConfirm':
		'このQRコードを削除しますか？アクセスログも削除されます。',
	'qrCodes.createFailed': 'QRコードの作成に失敗しました',
	'qrCodes.editFailed': 'QRコードの更新に失敗しました',
	'qrCodes.deleteFailed': '削除に失敗しました',
	'qrCodes.qrIdHeader': 'QR ID',
	'qrCodes.dialogTitle': 'QRコード',
	'qrCodes.generateFailed': 'QRコードの生成に失敗しました',
	'qrCodes.downloadButton': 'PNGをダウンロード',

	'csvExport.downloadFailed': 'CSVのダウンロードに失敗しました',
	'csvExport.disabled': 'CSVダウンロード機能は現在無効です',
};

const dictionaries: Record<Locale, Dictionary> = { en, ja };

function interpolate(
	template: string,
	vars?: Record<string, string | number>,
): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, key) =>
		key in vars ? String(vars[key]) : match,
	);
}

function detectDefaultLocale(): Locale {
	const stored = localStorage.getItem(LOCALE_KEY);
	if (stored === 'en' || stored === 'ja') return stored;
	return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

interface LocaleContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
	const [locale, setLocale] = useState<Locale>(detectDefaultLocale);

	useEffect(() => {
		localStorage.setItem(LOCALE_KEY, locale);
		document.documentElement.lang = locale;
	}, [locale]);

	const t = useCallback(
		(key: string, vars?: Record<string, string | number>) => {
			const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
			return interpolate(template, vars);
		},
		[locale],
	);

	const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

	return (
		<LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
	);
}

export function useTranslation(): LocaleContextValue {
	const ctx = useContext(LocaleContext);
	if (!ctx)
		throw new Error('useTranslation must be used within a LocaleProvider');
	return ctx;
}
