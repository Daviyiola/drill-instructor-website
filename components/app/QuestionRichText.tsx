import {questionRichHtml} from "@/lib/drills/text";

export default function QuestionRichText({value}: {value: string}) {
  return (
    <span dangerouslySetInnerHTML={{__html: questionRichHtml(value)}} />
  );
}
