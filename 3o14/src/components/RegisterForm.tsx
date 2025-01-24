import { clsx } from "clsx"

export type RegisterFormErrors = Record<string, { message: string }>;

export interface RegisterFormProps {
  email?: string,
  username?: string,
  password?: string,
  confirmPassword?: string,
  errors?: RegisterFormErrors,
}

export function RegisterForm(props: RegisterFormProps) {
  return (
    <div>
      <h2 class="card-title">Register</h2>
      <form hx-post="/auth/register" hx-target="closest div" hx-swap="outerHTML">
        <div class="form-control w-full max-w-xs">
          <label class="label" for="email">
            <span class="label-text">Email</span>
          </label>
          <input
            type="email"
            placeholder="enter your email"
            id="email"
            name="email"
            value={props.email}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.email,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.email && props.errors.email.message}
          </p>
        </div>


        <div class="form-control w-full max-w-xs">
          <label class="label" for="username">
            <span class="label-text">Username</span>
          </label>
          <input
            type="text"
            placeholder="enter your username"
            id="username"
            name="username"
            value={props.username}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.username,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.username && props.errors.username.message}
          </p>
        </div>


        <div class="form-control w-full max-w-xs">
          <label class="label" for="password">
            <span class="label-text">Password</span>
          </label>
          <input
            type="password"
            placeholder="enter your password"
            id="password"
            name="password"
            value={props.password}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.password,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.password && props.errors.password.message}
          </p>
        </div>


        <div class="form-control w-full max-w-xs">
          <label class="label" for="passwordConfirm">
            <span class="label-text">Confirm Password</span>
          </label>
          <input
            type="password"
            placeholder="confirm password"
            id="passwordConfirm"
            name="passwordConfirm"
            value={props.confirmPassword}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.passwordConfirm,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.passwordConfirm && props.errors.passwordConfirm.message}
          </p>
        </div>

        <div class="mt-2 flex">
          <button class="btn btn-primary" type="submit">
            Register
          </button>
        </div>
      </form>
    </div>
  )
}
