import type { AppUser } from '$lib/server/users';

declare global {
	namespace App {
		interface Locals {
			user: AppUser;
		}
	}
}

export {};
