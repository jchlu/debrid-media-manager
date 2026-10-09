import useLocalStorage from '@/hooks/localStorage';
import { getUserData } from '@/services/torbox';
import { getSafeRedirectPath } from '@/utils/router';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';

/**
 * The reason a validation call failed, in the words of whoever refused it.
 *
 * TorBox answers application conditions in its own envelope and puts the prose
 * in `detail`, never in `message` - so reading `data.message` alone reported
 * every one of them as the bare axios string "Request failed with status code
 * 403", which says nothing about the key being the thing at fault. `error` is
 * `false` rather than absent on some bodies, so it is only used when it is a
 * non-empty string. The proxy route answers in plain text instead, hence the
 * string case.
 */
const describeFailure = (err: any): string => {
	const data = err?.response?.data;
	const text = (value: unknown): string =>
		typeof value === 'string' ? value.trim().replace(/\.$/, '') : '';
	const detail = text(data?.detail);
	if (detail) return detail;
	const code = text(data?.error);
	if (code) return code;
	const plainText = text(data);
	if (plainText) return plainText;
	const message = text(data?.message);
	if (message) return message;
	return err?.message || 'Could not validate API key';
};

export default function TorboxLoginPage() {
	const router = useRouter();
	const [, setApiKey] = useLocalStorage<string>('tb:apiKey');
	const [inputApiKey, setInputApiKey] = useState('');
	const [error, setError] = useState('');

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		console.log('[TorboxLogin] validating api key', {
			redirect: router.query.redirect,
		});
		try {
			// Verify the API key works by attempting to get user info
			const userData = await getUserData(inputApiKey);
			console.log('[TorboxLogin] user data received', {
				success: userData?.success ?? false,
			});

			// If successful, save the API key
			setApiKey(inputApiKey);
			const redirectPath = getSafeRedirectPath(router.query.redirect, '/');
			console.log('[TorboxLogin] redirecting after login', { redirectPath });
			await router.replace(redirectPath);
		} catch (err: any) {
			console.error(
				'Failed to validate API key:',
				err instanceof Error ? err.message : 'Unknown error'
			);
			console.error('[TorboxLogin] validation failed', err);
			setError(
				`API Error: ${describeFailure(err)}. Status: ${err.response?.status || 'unknown'}`
			);
		}
	};

	const handleGetApiKey = () => {
		console.log('[TorboxLogin] opening torbox settings for api key');
		window.open('https://torbox.app/settings', '_blank');
	};

	return (
		<div className="flex h-screen flex-col items-center justify-center">
			<Head>
				<title>Debrid Media Manager - Torbox Login</title>
			</Head>
			<div className="w-full max-w-md space-y-4 p-4">
				<h1 className="text-center text-2xl font-bold">Connect Torbox</h1>
				{error && <p className="text-center text-red-500">{error}</p>}
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="apiKey" className="block text-sm font-medium">
							API Key
						</label>
						<input
							type="text"
							id="apiKey"
							value={inputApiKey}
							onChange={(e) => setInputApiKey(e.target.value)}
							className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							placeholder="Enter your Torbox API key"
							required
						/>
					</div>
					<div className="flex flex-col space-y-2">
						<button
							type="submit"
							className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
						>
							Save API Key
						</button>
						<button
							type="button"
							onClick={handleGetApiKey}
							className="rounded bg-green-700 px-4 py-2 text-white hover:bg-green-800"
						>
							Get API Key from Torbox
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
