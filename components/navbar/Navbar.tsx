'use client'

import React, { useState } from 'react'
import { type ComponentType, type SVGProps } from 'react'
import {
    Dialog,
    DialogPanel,
    Disclosure,
    DisclosureButton,
    DisclosurePanel,
    Popover,
    PopoverButton,
    PopoverGroup,
    PopoverPanel,
} from '@headlessui/react'
import {
    Bars3Icon,
    XMarkIcon,
} from '@heroicons/react/24/outline'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { Session } from 'next-auth'
import Image from 'next/image'
import defaultProfileImage from "@/public/defaultProfileImage.jpg"
import MoreItemsMenu from './MoreItemsMenu'
import LogButton from '../logButton/LogButton'
import Link from 'next/link'
import { useAtom } from 'jotai'
import { showingLanguageSelectionGlobal } from '@/utility/globalState'

const menu: {
    name: string,
    href: string,
    icon: ComponentType<SVGProps<SVGSVGElement>>,
    subMenu?: {
        name: string,
        href: string,
        icon: ComponentType<SVGProps<SVGSVGElement>>,
        description?: string,
    }[],
    callsToAction?: { name: string, href: string, icon: ComponentType<SVGProps<SVGSVGElement>> }[]
}[] = [
        // {
        //     name: 'books',
        //     href: '/books',
        //     icon: SquaresPlusIcon,
        //     // subMenu: [
        //     //     { name: 'Analytics', description: 'Get a better understanding of your traffic', href: '#', icon: ChartPieIcon },
        //     //     { name: 'Engagement', description: 'Speak directly to your customers', href: '#', icon: CursorArrowRaysIcon },
        //     //     { name: 'Security', description: 'Your customers’ data will be safe and secure', href: '#', icon: FingerPrintIcon },
        //     //     { name: 'Integrations', description: 'Connect with third-party tools', href: '#', icon: SquaresPlusIcon },
        //     //     { name: 'Automations', description: 'Build strategic funnels that will convert', href: '#', icon: ArrowPathIcon },
        //     // ]
        // },
        // { //products example
        //     name: 'products',
        //     href: '/products',
        //     icon: SquaresPlusIcon,
        //     subMenu: [
        //         {
        //             name: "sub1",
        //             href: "#",
        //             icon: SquaresPlusIcon,
        //             description: "description 1",
        //         }
        //     ],
        //     callsToAction: [{ name: 'Watch demo', href: '#', icon: PlayCircleIcon }]
        // },
    ]

export default function Navbar({ session }: { session: Session | null }) {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [showingLanguageSelection, showingLanguageSelectionSet] = useAtom(showingLanguageSelectionGlobal)

    const moreNavMenuContent = (
        <div className='simpleGrid'>
            <LogButton option={session === null ? "login" : "logout"} />

            {!showingLanguageSelection && (
                <button onClick={() => showingLanguageSelectionSet(true)}>
                    Language Settings
                </button>
            )}
        </div>
    )

    return (
        <header className="bg-white dark:bg-gray-900">
            <nav aria-label="Global" className="mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8">
                <div className="flex lg:flex-1">
                    <a href="/" className="-m-1.5 p-1.5">
                        <span className="sr-only">Your Company</span>
                        <img
                            alt=""
                            src="https://tailwindcss.com/plus-assets/img/logos/mark.svg?color=indigo&shade=600"
                            className="h-8 w-auto dark:hidden"
                        />
                        <img
                            alt=""
                            src="https://tailwindcss.com/plus-assets/img/logos/mark.svg?color=indigo&shade=500"
                            className="h-8 w-auto not-dark:hidden"
                        />
                    </a>
                </div>

                <div className="flex lg:hidden">
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(true)}
                        className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-400"
                    >
                        <span className="sr-only">Open main menu</span>
                        <Bars3Icon aria-hidden="true" className="size-6" />
                    </button>
                </div>

                <PopoverGroup className="hidden lg:flex lg:gap-x-12">
                    {menu.map((eachMenuItem, eachMenuItemIndex) => {
                        return (
                            <React.Fragment key={eachMenuItemIndex}>
                                {eachMenuItem.subMenu === undefined && (
                                    <a href={eachMenuItem.href} className="text-sm/6 font-semibold text-gray-900 dark:text-white">
                                        {eachMenuItem.name}
                                    </a>
                                )}

                                {eachMenuItem.subMenu !== undefined && (
                                    <Popover className="relative">
                                        <PopoverButton className="flex items-center gap-x-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
                                            {eachMenuItem.name}
                                            <ChevronDownIcon aria-hidden="true" className="size-5 flex-none text-gray-400 dark:text-gray-500" />
                                        </PopoverButton>

                                        <PopoverPanel
                                            transition
                                            className="absolute left-1/2 z-10 mt-3 w-screen max-w-md -translate-x-1/2 overflow-hidden rounded-3xl bg-white shadow-lg outline-1 outline-gray-900/5 transition data-closed:translate-y-1 data-closed:opacity-0 data-enter:duration-200 data-enter:ease-out data-leave:duration-150 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
                                        >
                                            <div className="p-4">
                                                {eachMenuItem.subMenu.map((eachSubMenuItem, eachSubMenuItemIndex) => (
                                                    <div
                                                        key={eachSubMenuItemIndex}
                                                        className="group relative flex items-center gap-x-6 rounded-lg p-4 text-sm/6 hover:bg-gray-50 dark:hover:bg-white/5"
                                                    >
                                                        <div className="flex size-11 flex-none items-center justify-center rounded-lg bg-gray-50 group-hover:bg-white dark:bg-gray-700/50 dark:group-hover:bg-gray-700">
                                                            <eachSubMenuItem.icon
                                                                aria-hidden="true"
                                                                className="size-6 text-gray-600 group-hover:text-indigo-600 dark:text-gray-400 dark:group-hover:text-white"
                                                            />
                                                        </div>

                                                        <div className="flex-auto">
                                                            <a href={eachSubMenuItem.href} className="block font-semibold text-gray-900 dark:text-white">
                                                                {eachSubMenuItem.name}
                                                                <span className="absolute inset-0" />
                                                            </a>

                                                            {eachSubMenuItem.description !== undefined && (
                                                                <p className="mt-1 text-gray-600 dark:text-gray-400">{eachSubMenuItem.description}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {eachMenuItem.callsToAction !== undefined && (
                                                <div className="grid grid-cols-2 divide-x divide-gray-900/5 bg-gray-50 dark:divide-white/10 dark:bg-gray-700/50">
                                                    {eachMenuItem.callsToAction.map((eachCallToAction) => (
                                                        <a
                                                            key={eachCallToAction.name}
                                                            href={eachCallToAction.href}
                                                            className="flex items-center justify-center gap-x-2.5 p-3 text-sm/6 font-semibold text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-700/50"
                                                        >
                                                            <eachCallToAction.icon aria-hidden="true" className="size-5 flex-none text-gray-400 dark:text-gray-500" />
                                                            {eachCallToAction.name}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </PopoverPanel>
                                    </Popover>
                                )}
                            </React.Fragment>
                        )
                    })}
                </PopoverGroup>

                <div className="hidden lg:flex lg:flex-1 lg:justify-end">
                    {session === null ? (
                        <LogButton option='login' />
                    ) : (
                        <MoreItemsMenu
                            top={(
                                <>
                                    <Image alt='profile' src={session.user.image ?? defaultProfileImage} width={30} height={30} />
                                </>
                            )}

                            bottom={(
                                <>
                                    {moreNavMenuContent}
                                </>
                            )}
                        />
                    )}
                </div>
            </nav>

            <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
                <div className="fixed inset-0 z-50" />

                <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white p-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10 dark:bg-gray-900 dark:sm:ring-gray-100/10">
                    <div className="flex items-center justify-between">
                        <a href="/" className="-m-1.5 p-1.5">
                            <span className="sr-only">Your Company</span>
                            <img
                                alt=""
                                src="https://tailwindcss.com/plus-assets/img/logos/mark.svg?color=indigo&shade=600"
                                className="h-8 w-auto dark:hidden"
                            />
                            <img
                                alt=""
                                src="https://tailwindcss.com/plus-assets/img/logos/mark.svg?color=indigo&shade=500"
                                className="h-8 w-auto not-dark:hidden"
                            />
                        </a>

                        <button
                            type="button"
                            onClick={() => setMobileMenuOpen(false)}
                            className="-m-2.5 rounded-md p-2.5 text-gray-700 dark:text-gray-400"
                        >
                            <span className="sr-only">Close menu</span>
                            <XMarkIcon aria-hidden="true" className="size-6" />
                        </button>
                    </div>

                    <div className="mt-6 flow-root">
                        <div className="-my-6 divide-y divide-gray-500/10 dark:divide-white/10">
                            <div className="space-y-2 py-6">
                                {menu.map((eachMenuItem, eachMenuItemIndex) => {
                                    return (
                                        <Disclosure key={eachMenuItemIndex} as="div" className="-mx-3">
                                            <DisclosureButton className="group flex w-full items-center justify-between rounded-lg py-2 pr-3.5 pl-3 text-base/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5">
                                                {eachMenuItem.subMenu === undefined ? (
                                                    <Link href={eachMenuItem.href}>{eachMenuItem.name}</Link>
                                                ) : (
                                                    <>
                                                        {eachMenuItem.name}

                                                        <ChevronDownIcon aria-hidden="true" className="size-5 flex-none group-data-open:rotate-180" />
                                                    </>
                                                )}
                                            </DisclosureButton>

                                            <DisclosurePanel className="mt-2 space-y-2">
                                                {[...(eachMenuItem.subMenu ?? []), ...(eachMenuItem.callsToAction ?? [])].map((item) => (
                                                    <DisclosureButton
                                                        key={item.name}
                                                        as="a"
                                                        href={item.href}
                                                        className="block rounded-lg py-2 pr-3 pl-6 text-sm/7 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                                                    >
                                                        {item.name}
                                                    </DisclosureButton>
                                                ))}
                                            </DisclosurePanel>
                                        </Disclosure>
                                    )
                                })}
                            </div>

                            <div className="py-6">
                                {moreNavMenuContent}
                            </div>
                        </div>
                    </div>
                </DialogPanel>
            </Dialog>
        </header>
    )
}