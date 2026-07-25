import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { safeStorage } from './storage';

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
	'common.retry': 'Try again',
	'common.optional': 'optional',
	'common.medium': 'Medium',
	'common.bot': 'Bot',
	'common.deleting': 'Deleting…',
	'common.saving': 'Saving…',
	'common.menu': 'Menu',
	'common.discardChanges': 'Discard your unsaved changes?',

	// Errors, keyed off the API's error codes so wording lives on the client.
	'error.network':
		'Could not reach the server. Check your connection and try again.',
	'error.unauthorized': 'Your session has expired. Please sign in again.',
	'error.permission': "You don't have permission to do that.",
	'error.notOwner': 'You can only change QR codes you created.',
	'error.invalidBody': 'Please check the highlighted fields.',
	'error.noFieldsToUpdate': 'Nothing was changed.',
	'error.projectNotFound':
		'That project no longer exists. It may have been deleted.',
	'error.qrNotFound':
		'That QR code no longer exists. It may have been deleted.',
	'error.duplicateName':
		'A QR code with this name already exists in this project.',
	'error.tooManyRows':
		'Too many rows ({total}) to export at once. The limit is {max} — narrow the date range.',
	'error.rateLimited': 'Too many attempts. Please wait a moment and try again.',
	'error.serverError': 'The server had a problem. Please try again.',

	'validation.required': 'This field is required.',
	'validation.tooLong': 'Please use {max} characters or fewer.',
	'validation.url': 'Enter a URL starting with http:// or https://',

	'login.sessionExpired': 'Your session expired. Please sign in again.',
	'login.retryAfterNetwork':
		'Could not reach the server. Check your connection.',

	'login.subtitle': 'Sign in with the admin password.',
	'login.passwordLabel': 'Password',
	'login.signIn': 'Sign in',
	'login.signingIn': 'Signing in…',
	'login.failed': 'Login failed',
	'login.invalidPassword': 'Invalid password',

	'nav.projects': 'Projects',
	'nav.newProject': 'New project',
	'nav.logOut': 'Log out',
	'nav.language': 'Language',

	'permission.noAccessTitle': "You don't have access to this page.",
	'permission.noAccessDesc':
		'Contact an administrator if you believe this is a mistake.',

	'pagination.range': '{start}–{end} of {total}',
	'pagination.previous': 'Previous page',
	'pagination.next': 'Next page',

	'projects.heading': 'TrackingLink',
	'projects.cardTitle': 'Projects',
	'projects.empty': 'No projects yet.',
	'projects.qrCodesLink': 'QR codes',
	'projects.csvDownloadLink': 'Download CSV',
	'projects.editFormTitle': 'Edit project',
	'projects.editFailed': 'Failed to update the project',
	'projects.created': 'Project created',
	'projects.updated': 'Project updated',
	'projects.deleted': 'Project deleted',
	'projects.deleteTitle': 'Delete project',
	'projects.deleteBody':
		'Delete “{name}”?\n\nIts QR codes and all of their scan history will be deleted too. This cannot be undone.',
	'projects.deleteFailed': 'Failed to delete the project',
	'projects.emptyCta': 'Create your first project',
	'projects.destinationUrlPropagation':
		'A changed destination URL can take up to a minute to take effect for everyone.',

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
	'qrCodes.editFormTitleNamed': 'Edit “{name}”',
	'qrCodes.nameHint':
		'One QR code per item, so this has to be unique within the project.',
	'qrCodes.created': 'QR code created',
	'qrCodes.updated': 'QR code updated',
	'qrCodes.deleted': 'QR code deleted',
	'qrCodes.deleteTitle': 'Delete QR code',
	'qrCodes.deleteBody':
		'Delete “{name}”?\n\nIts scan history will be deleted too, and anything already printed with this code will stop working. This cannot be undone.',
	'qrCodes.createFailed': 'Failed to create the QR code',
	'qrCodes.editFailed': 'Failed to update the QR code',
	'qrCodes.deleteFailed': 'Failed to delete',
	'qrCodes.qrIdHeader': 'QR ID',
	'qrCodes.dialogTitle': 'QR code',
	'qrCodes.imageAlt': 'QR code for {name}',
	'qrCodes.scanUrlLabel': 'This code links to',
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
	'common.retry': '再試行',
	'common.optional': '任意',
	'common.medium': '媒体',
	'common.bot': 'ボット',
	'common.deleting': '削除中…',
	'common.saving': '保存中…',
	'common.menu': 'メニュー',
	'common.discardChanges': '保存していない変更を破棄しますか？',

	// Errors, keyed off the API's error codes so wording lives on the client.
	'error.network':
		'サーバーに接続できませんでした。通信環境を確認して再試行してください。',
	'error.unauthorized':
		'セッションの有効期限が切れました。再度ログインしてください。',
	'error.permission': 'この操作を行う権限がありません。',
	'error.notOwner': '自分が作成したQRコードのみ変更できます。',
	'error.invalidBody': '入力内容を確認してください。',
	'error.noFieldsToUpdate': '変更点がありません。',
	'error.projectNotFound':
		'このプロジェクトは存在しません。削除された可能性があります。',
	'error.qrNotFound':
		'このQRコードは存在しません。削除された可能性があります。',
	'error.duplicateName': 'この名前のQRコードはこのプロジェクトに既にあります。',
	'error.tooManyRows':
		'件数が多すぎます（{total}件）。一度に出力できるのは{max}件までです。期間を絞ってください。',
	'error.rateLimited':
		'試行回数が多すぎます。しばらく待ってから再試行してください。',
	'error.serverError': 'サーバー側で問題が発生しました。再試行してください。',

	'validation.required': 'この項目は必須です。',
	'validation.tooLong': '{max}文字以内で入力してください。',
	'validation.url': 'http:// または https:// で始まるURLを入力してください。',

	'login.sessionExpired':
		'セッションの有効期限が切れました。再度ログインしてください。',
	'login.retryAfterNetwork':
		'サーバーに接続できませんでした。通信環境を確認してください。',

	'login.subtitle': '管理者パスワードでログインしてください。',
	'login.passwordLabel': 'パスワード',
	'login.signIn': 'ログイン',
	'login.signingIn': 'ログイン中…',
	'login.failed': 'ログインに失敗しました',
	'login.invalidPassword': 'パスワードが正しくありません',

	'nav.projects': 'プロジェクト',
	'nav.newProject': 'プロジェクト作成',
	'nav.logOut': 'ログアウト',
	'nav.language': '言語',

	'permission.noAccessTitle': 'このページへのアクセス権限がありません。',
	'permission.noAccessDesc':
		'心当たりがない場合は管理者にお問い合わせください。',

	'pagination.range': '{start}〜{end} 件（全 {total} 件）',
	'pagination.previous': '前のページ',
	'pagination.next': '次のページ',

	'projects.heading': 'TrackingLink',
	'projects.cardTitle': 'プロジェクト一覧',
	'projects.empty': 'プロジェクトがありません。',
	'projects.qrCodesLink': 'QRコード',
	'projects.csvDownloadLink': 'CSVダウンロード',
	'projects.editFormTitle': 'プロジェクトを編集',
	'projects.editFailed': 'プロジェクトの更新に失敗しました',
	'projects.created': 'プロジェクトを作成しました',
	'projects.updated': 'プロジェクトを更新しました',
	'projects.deleted': 'プロジェクトを削除しました',
	'projects.deleteTitle': 'プロジェクトを削除',
	'projects.deleteBody':
		'「{name}」を削除しますか？\n\nこのプロジェクトのQRコードと、そのアクセスログもすべて削除されます。この操作は取り消せません。',
	'projects.deleteFailed': 'プロジェクトの削除に失敗しました',
	'projects.emptyCta': '最初のプロジェクトを作成',
	'projects.destinationUrlPropagation':
		'転送先URLの変更は、全員に反映されるまで最大1分かかることがあります。',

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
	'qrCodes.editFormTitleNamed': '「{name}」を編集',
	'qrCodes.nameHint':
		'物ごとに1つのQRコードを発行するため、プロジェクト内で重複しない名前にしてください。',
	'qrCodes.created': 'QRコードを作成しました',
	'qrCodes.updated': 'QRコードを更新しました',
	'qrCodes.deleted': 'QRコードを削除しました',
	'qrCodes.deleteTitle': 'QRコードを削除',
	'qrCodes.deleteBody':
		'「{name}」を削除しますか？\n\nアクセスログも削除され、このコードで既に印刷したものは読み取れなくなります。この操作は取り消せません。',
	'qrCodes.createFailed': 'QRコードの作成に失敗しました',
	'qrCodes.editFailed': 'QRコードの更新に失敗しました',
	'qrCodes.deleteFailed': '削除に失敗しました',
	'qrCodes.qrIdHeader': 'QR ID',
	'qrCodes.dialogTitle': 'QRコード',
	'qrCodes.imageAlt': '「{name}」のQRコード',
	'qrCodes.scanUrlLabel': 'このコードの転送先',
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
	// safeStorage, not localStorage: this runs inside a useState initialiser, so a
	// throw here (Safari Private Browsing, storage blocked) white-screens the app.
	const stored = safeStorage.get(LOCALE_KEY);
	if (stored === 'en' || stored === 'ja') return stored;
	try {
		return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
	} catch {
		return 'en';
	}
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
		safeStorage.set(LOCALE_KEY, locale);
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
