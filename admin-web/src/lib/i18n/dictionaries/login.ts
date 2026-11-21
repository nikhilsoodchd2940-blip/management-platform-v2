import { ns } from '../types';

export default ns({
  title: 'Admin sign in',
  email: 'Email',
  password: 'Password',
  submit: 'Sign in',
  submitting: 'Signing in…',
  failed: 'Sign-in failed',
  errors: {
    invalidCredential: 'Incorrect email or password.',
    invalidEmail: 'This email address is not valid.',
    userDisabled: 'This account has been disabled. Contact an administrator.',
    tooManyRequests: 'Too many attempts. Wait a few minutes before trying again.',
    network: 'Could not connect. Check your network and try again.',
  },
  showPassword: 'Show password',
  hidePassword: 'Hide password',
});
