import { h } from "preact"

export const Icon = ({ name }: { name: string }) => {
    return <span className="icon" dangerouslySetInnerHTML={{__html:`<icon|${name} />`}} />
}