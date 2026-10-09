import TorboxLoginPage from '@/pages/torbox/login';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useRouterMock, useLocalStorageMock, getUserDataMock, getSafeRedirectPathMock } = vi.hoisted(
	() => ({
		useRouterMock: vi.fn(),
		useLocalStorageMock: vi.fn(),
		getUserDataMock: vi.fn(),
		getSafeRedirectPathMock: vi.fn(),
	})
);

vi.mock('next/router', () => ({
	useRouter: useRouterMock,
}));

vi.mock('@/hooks/localStorage', () => ({
	default: useLocalStorageMock,
}));

vi.mock('@/services/torbox', () => ({
	getUserData: getUserDataMock,
}));

vi.mock('@/utils/router', () => ({
	getSafeRedirectPath: getSafeRedirectPathMock,
}));

describe('Torbox login page', () => {
	const replaceMock = vi.fn();
	const setApiKeyMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		useRouterMock.mockReturnValue({
			query: { redirect: '/library' },
			replace: replaceMock,
		});
		useLocalStorageMock.mockReturnValue([null, setApiKeyMock]);
		getSafeRedirectPathMock.mockReturnValue('/library');
		(window as any).open = vi.fn();
	});

	const submitApiKey = (value: string) => {
		render(<TorboxLoginPage />);
		fireEvent.change(screen.getByLabelText(/api key/i), { target: { value } });
		fireEvent.click(screen.getByRole('button', { name: /save api key/i }));
	};

	it('validates and stores the API key before redirecting', async () => {
		getUserDataMock.mockResolvedValue({ success: true });

		submitApiKey('tb-key');

		await waitFor(() => expect(getUserDataMock).toHaveBeenCalledWith('tb-key'));
		expect(setApiKeyMock).toHaveBeenCalledWith('tb-key');
		expect(replaceMock).toHaveBeenCalledWith('/library');
	});

	it('surfaced API errors to the user', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'bad key',
			response: { data: { message: 'invalid' }, status: 401 },
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(screen.getByText(/API Error: invalid. Status: 401/i)).toBeInTheDocument()
		);
	});

	it('opens the Torbox settings link', () => {
		render(<TorboxLoginPage />);
		fireEvent.click(screen.getByRole('button', { name: /get api key/i }));
		expect(window.open).toHaveBeenCalledWith('https://torbox.app/settings', '_blank');
	});

	// TorBox carries the reason in `detail` and leaves `message` unset, so
	// reading `message` alone reported a rejected key as a bare axios string.
	it("reports TorBox's own reason for a refused key", async () => {
		getUserDataMock.mockRejectedValue({
			message: 'Request failed with status code 403',
			response: {
				data: {
					success: false,
					error: 'BAD_TOKEN',
					detail: 'Your token is invalid or has expired.',
					data: null,
				},
				status: 403,
			},
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(
				screen.getByText(/API Error: Your token is invalid or has expired\. Status: 403/i)
			).toBeInTheDocument()
		);
	});

	it('does not double the period when the reason already ends in one', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'Request failed with status code 403',
			response: {
				data: { success: false, error: 'BAD_TOKEN', detail: 'Token expired.' },
				status: 403,
			},
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(screen.getByText(/API Error: Token expired\. Status: 403/i)).toBeInTheDocument()
		);
		expect(screen.queryByText(/expired\.\./)).not.toBeInTheDocument();
	});

	it('falls back to the error code when TorBox sends no detail', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'Request failed with status code 403',
			response: { data: { success: false, error: 'BAD_TOKEN', detail: '' }, status: 403 },
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(screen.getByText(/API Error: BAD_TOKEN\. Status: 403/i)).toBeInTheDocument()
		);
	});

	it('ignores a falsy error field rather than printing it', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'Request failed with status code 500',
			response: { data: { success: false, error: false, detail: '' }, status: 500 },
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(
				screen.getByText(/API Error: Request failed with status code 500\. Status: 500/i)
			).toBeInTheDocument()
		);
	});

	it('surfaces a plain-text refusal from the proxy route', async () => {
		getUserDataMock.mockRejectedValue({
			message: 'Request failed with status code 403',
			response: { data: 'Host is not allowed', status: 403 },
		});

		submitApiKey('tb-key');

		await waitFor(() =>
			expect(
				screen.getByText(/API Error: Host is not allowed\. Status: 403/i)
			).toBeInTheDocument()
		);
	});
});
