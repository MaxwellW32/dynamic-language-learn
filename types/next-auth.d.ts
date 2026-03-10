import type { Session } from 'next-auth';
import { userType } from '@/types';

declare module 'next-auth' {
    interface Session {
        user: userType
    }
}